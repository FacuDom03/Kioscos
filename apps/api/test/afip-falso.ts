// Afip SDK + ARCA falsos para las pruebas: numeración correlativa por CUIT, punto de venta y
// tipo; rechazo 10016 si el número o la fecha no son los próximos; autorización por CUIT; y
// controles para simular una caída o una respuesta que se pierde.

interface Emitido {
  numero: number;
  fecha: string;
  total: number;
  cae: string;
}

export class AfipFalso {
  /** CUIT que autorizaron a Mostrador (el de pruebas siempre está). */
  autorizados = new Set<string>(['20409378472']);
  /** Puntos de venta Web Services por CUIT. */
  puntos = new Map<string, number[]>();
  emitidos = new Map<string, Emitido[]>();
  caido = false;
  /** El próximo FECAESolicitar se autoriza, pero la respuesta no llega. */
  perderRespuesta = false;
  /** El próximo FECAESolicitar se rechaza con este código. */
  rechazar: { codigo: number; mensaje: string } | null = null;
  pedidos = 0;
  /** Padrón de ARCA: lo que devuelve getPersona_v2 por CUIT. */
  padron = new Map<string, unknown>([
    [
      '20111111112',
      {
        datosGenerales: {
          apellido: 'PEREZ',
          nombre: 'ANA',
          estadoClave: 'ACTIVO',
          domicilioFiscal: {
            direccion: 'CALLE 1 123',
            localidad: 'RAMOS MEJIA',
            descripcionProvincia: 'BUENOS AIRES',
            codPostal: '1704',
          },
        },
        datosRegimenGeneral: { impuesto: [{ idImpuesto: 30 }] },
      },
    ],
  ]);
  /** El último comprobante pedido (para revisar qué se le mandó a ARCA). */
  ultimoDetalle: Record<string, unknown> | null = null;
  private cae = 70000000000000;

  private clave = (cuit: unknown, pv: unknown, tipo: unknown) => `${cuit}-${pv}-${tipo}`;

  fetch = (async (url: string, init: RequestInit) => {
    this.pedidos++;
    const cuerpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    const json = (datos: unknown, status = 200) => new Response(JSON.stringify(datos), { status });
    if (this.caido) return json({ message: 'ARCA no responde' }, 502);

    if (url.endsWith('v1/afip/auth')) {
      if (!this.autorizados.has(String(cuerpo['tax_id'])))
        return json({ message: 'Computador no autorizado a acceder al servicio' }, 400);
      return json({
        token: 'tok',
        sign: 'firma',
        expiration: new Date(Date.now() + 3600_000).toISOString(),
      });
    }
    const metodo = String(cuerpo['method']);
    if (metodo === 'getPersona_v2') {
      const id = String((cuerpo['params'] as { idPersona: number }).idPersona);
      const persona = this.padron.get(id);
      return persona
        ? json({ personaReturn: persona })
        : json({ message: 'No existe persona con ese Id' }, 500);
    }
    const p = cuerpo['params'] as Record<string, Record<string, unknown>>;
    const cuit = String(p['Auth']?.['Cuit'] ?? '');
    const r = (resultado: unknown) => json({ [`${metodo}Result`]: resultado });

    if (metodo === 'FEDummy') return r({ AppServer: 'OK', DbServer: 'OK', AuthServer: 'OK' });
    if (metodo === 'FEParamGetPtosVenta')
      return r({
        ResultGet: {
          PtoVenta: (this.puntos.get(cuit) ?? []).map((n) => ({
            Nro: n,
            EmisionTipo: 'CAE - Web Services',
            Bloqueado: 'N',
            FchBaja: 'NULL',
          })),
        },
      });
    if (metodo === 'FECompUltimoAutorizado') {
      const lista = this.emitidos.get(this.clave(cuit, p['PtoVta'], p['CbteTipo'])) ?? [];
      return r({ CbteNro: lista.at(-1)?.numero ?? 0 });
    }
    if (metodo === 'FECompConsultar') {
      const q = p['FeCompConsReq']!;
      const e = (this.emitidos.get(this.clave(cuit, q['PtoVta'], q['CbteTipo'])) ?? []).find(
        (x) => x.numero === q['CbteNro'],
      );
      if (!e) return r({ Errors: { Err: { Code: 602, Msg: 'Sin resultados' } } });
      return r({
        ResultGet: {
          CbteFch: e.fecha,
          ImpTotal: e.total / 100,
          CodAutorizacion: e.cae,
          FchVto: '20991231',
          Resultado: 'A',
        },
      });
    }
    if (metodo === 'FECAESolicitar') {
      const req = p['FeCAEReq'] as {
        FeCabReq: { PtoVta: number; CbteTipo: number };
        FeDetReq: { FECAEDetRequest: { CbteDesde: number; CbteFch: number; ImpTotal: number } };
      };
      const det = req.FeDetReq.FECAEDetRequest;
      this.ultimoDetalle = det as unknown as Record<string, unknown>;
      const clave = this.clave(cuit, req.FeCabReq.PtoVta, req.FeCabReq.CbteTipo);
      const lista = this.emitidos.get(clave) ?? [];
      const ultimo = lista.at(-1);
      const rechazo = (codigo: number, mensaje: string) =>
        r({
          FeDetResp: {
            FECAEDetResponse: {
              Resultado: 'R',
              Observaciones: { Obs: { Code: codigo, Msg: mensaje } },
            },
          },
        });
      if (this.rechazar) {
        const { codigo, mensaje } = this.rechazar;
        this.rechazar = null;
        return rechazo(codigo, mensaje);
      }
      if (
        det.CbteDesde !== (ultimo?.numero ?? 0) + 1 ||
        String(det.CbteFch) < (ultimo?.fecha ?? '')
      )
        return rechazo(10016, 'El numero o fecha del comprobante no se corresponde con el proximo');
      const e = {
        numero: det.CbteDesde,
        fecha: String(det.CbteFch),
        total: Math.round(det.ImpTotal * 100),
        cae: String(++this.cae),
      };
      this.emitidos.set(clave, [...lista, e]);
      if (this.perderRespuesta) {
        this.perderRespuesta = false;
        throw new TypeError('fetch failed');
      }
      return r({
        FeDetResp: { FECAEDetResponse: [{ Resultado: 'A', CAE: e.cae, CAEFchVto: '20991231' }] },
      });
    }
    return json({ message: `Método desconocido: ${metodo}` }, 400);
  }) as unknown as typeof fetch;
}
