// Cliente de Afip SDK para la facturación electrónica (docs/FACTURACION.md). Habla con su API
// (app.afipsdk.com) igual que su librería oficial, pero sin sumar dependencias y con una
// diferencia de seguridad: el permiso de ARCA (token y sign, dura unas 12 horas) se guarda acá
// hasta que vence. Así el certificado y la clave privada viajan una vez por comercio cada 12
// horas, y no en cada factura (además, cada inicio de sesión cuenta como pedido del plan).

const BASE = 'https://app.afipsdk.com/api/';
const WSFE = {
  produccion: {
    url: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
    wsdl: 'wsfe-production.wsdl',
  },
  pruebas: { url: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx', wsdl: 'wsfe.wsdl' },
};

// Padrón de ARCA (constancia de inscripción): nombre, condición frente al IVA y domicilio de un
// CUIT. Es SOAP 1.1 y usa otro permiso que la facturación.
const PADRON = {
  produccion: {
    url: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    wsdl: 'ws_sr_padron_a5-production.wsdl',
  },
  pruebas: {
    url: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA5',
    wsdl: 'ws_sr_padron_a5.wsdl',
  },
};

/** Lo que dice el padrón de ARCA de un CUIT. */
export interface PersonaPadron {
  cuit: string;
  nombre: string;
  condicion: 'responsable_inscripto' | 'monotributo' | 'exento' | 'consumidor_final';
  domicilio: string | null;
  /** La clave fiscal está activa. */
  activa: boolean;
}

/** CUIT de pruebas de Afip SDK: en desarrollo funciona sin certificado. */
export const CUIT_PRUEBAS_AFIPSDK = '20409378472';

export interface ConfigAfipSdk {
  accessToken: string;
  produccion: boolean;
  /** Certificado y clave privada de Mostrador. Con el CUIT de pruebas no hacen falta. */
  cert?: string;
  key?: string;
  esperaMs?: number;
  /** En pruebas, un fetch falso. */
  fetch?: typeof fetch;
}

/**
 * - `arca`: ARCA rechazó el pedido (tiene el código de ARCA). No se reintenta si es un dato mal.
 * - `servicio`: Afip SDK respondió con error (por ejemplo, ARCA caída o el plan agotado).
 * - `red`: no hubo respuesta (se corta a los 30 segundos). Se reintenta.
 */
export class ErrorAfip extends Error {
  readonly tipo: 'arca' | 'servicio' | 'red';
  readonly codigo: number | null;
  readonly status: number | null;
  constructor(
    tipo: ErrorAfip['tipo'],
    mensaje: string,
    codigo: number | null = null,
    status: number | null = null,
  ) {
    super(mensaje);
    this.tipo = tipo;
    this.codigo = codigo;
    this.status = status;
  }
}

interface ErrorArca {
  Code: number;
  Msg: string;
}

/** Datos de un comprobante como los arma `camposDelComprobante` (`@mostrador/shared`). */
export interface DetalleComprobante {
  CbteTipo: number;
  PtoVta: number;
  CbteDesde: number;
  CbteHasta: number;
  Iva?: unknown[];
  CbtesAsoc?: unknown[];
  [campo: string]: unknown;
}

export interface Cae {
  cae: string;
  /** AAAA-MM-DD */
  vencimiento: string;
  observaciones: { codigo: number; mensaje: string }[];
}

const comoLista = <T>(x: T | T[] | undefined): T[] =>
  x === undefined ? [] : Array.isArray(x) ? x : [x];

/** Afip SDK espera números donde `camposDelComprobante` usa texto ("123.45", "20261019"). */
function conNumeros(valor: unknown): unknown {
  if (typeof valor === 'string' && /^-?\d+(\.\d+)?$/.test(valor)) return Number(valor);
  if (Array.isArray(valor)) return valor.map(conNumeros);
  if (valor && typeof valor === 'object')
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, conNumeros(v)]));
  return valor;
}

export class ClienteAfipSdk {
  private readonly config: ConfigAfipSdk;
  private readonly permisos = new Map<string, { token: string; sign: string; vence: number }>();

  constructor(config: ConfigAfipSdk) {
    this.config = config;
  }

  private get entorno() {
    return this.config.produccion ? 'prod' : 'dev';
  }

  private async pedir(ruta: string, cuerpo: unknown): Promise<Record<string, unknown>> {
    let r: Response;
    try {
      r = await (this.config.fetch ?? fetch)(`${BASE}${ruta}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.accessToken}`,
          'sdk-environment': this.entorno,
        },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(this.config.esperaMs ?? 30_000),
      });
    } catch {
      throw new ErrorAfip('red', 'Afip SDK no respondió.');
    }
    const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) {
      const mensaje = typeof datos['message'] === 'string' ? datos['message'] : r.statusText;
      throw new ErrorAfip('servicio', `Afip SDK respondió ${r.status}: ${mensaje}`, null, r.status);
    }
    return datos;
  }

  /** Permiso de ARCA para ese CUIT y servicio. Se pide de nuevo solo cuando vence. */
  private async permiso(cuit: string, wsid = 'wsfe'): Promise<{ token: string; sign: string }> {
    const clave = `${wsid}:${cuit}`;
    const guardado = this.permisos.get(clave);
    if (guardado && guardado.vence > Date.now()) return guardado;
    const r = await this.pedir('v1/afip/auth', {
      environment: this.entorno,
      wsid,
      tax_id: Number(cuit),
      force_create: false,
      ...(this.config.cert ? { cert: this.config.cert } : {}),
      ...(this.config.key ? { key: this.config.key } : {}),
    });
    const token = r['token'];
    const sign = r['sign'];
    if (typeof token !== 'string' || typeof sign !== 'string')
      throw new ErrorAfip('servicio', 'Afip SDK no devolvió el permiso de ARCA.');
    const expira = typeof r['expiration'] === 'string' ? Date.parse(r['expiration']) : NaN;
    // Cinco minutos antes de que venza; si no dice cuándo, se usa por 11 horas.
    const vence = Number.isFinite(expira) ? expira - 5 * 60_000 : Date.now() + 11 * 3600_000;
    this.permisos.set(clave, { token, sign, vence });
    return { token, sign };
  }

  /** Llama a un método del servicio de facturación (WSFEv1) en nombre de ese CUIT. */
  async wsfe(cuit: string | null, metodo: string, params: Record<string, unknown> = {}) {
    let auth = {};
    if (metodo !== 'FEDummy' && cuit) {
      const { token, sign } = await this.permiso(cuit);
      auth = { Auth: { Token: token, Sign: sign, Cuit: Number(cuit) } };
    }
    const destino = this.config.produccion ? WSFE.produccion : WSFE.pruebas;
    const r = await this.pedir('v1/afip/requests', {
      method: metodo,
      params: { ...params, ...auth },
      environment: this.entorno,
      wsid: 'wsfe',
      url: destino.url,
      wsdl: destino.wsdl,
      soap_v_1_2: true,
    });
    const resultado = r[`${metodo}Result`] as Record<string, unknown> | undefined;
    if (!resultado) throw new ErrorAfip('servicio', 'Afip SDK devolvió una respuesta sin datos.');
    const [error] = comoLista(
      (resultado['Errors'] as { Err?: ErrorArca | ErrorArca[] } | undefined)?.Err,
    );
    if (error) throw new ErrorAfip('arca', `(${error.Code}) ${error.Msg}`, Number(error.Code));
    return resultado;
  }

  /**
   * Datos de un CUIT en el padrón de ARCA, consultado en nombre de `representada` (Mostrador).
   * Devuelve null si el CUIT no existe.
   */
  async padron(representada: string, cuit: string): Promise<PersonaPadron | null> {
    const { token, sign } = await this.permiso(representada, 'ws_sr_constancia_inscripcion');
    const destino = this.config.produccion ? PADRON.produccion : PADRON.pruebas;
    let r: Record<string, unknown>;
    try {
      r = await this.pedir('v1/afip/requests', {
        method: 'getPersona_v2',
        params: { token, sign, cuitRepresentada: Number(representada), idPersona: Number(cuit) },
        environment: this.entorno,
        wsid: 'ws_sr_constancia_inscripcion',
        url: destino.url,
        wsdl: destino.wsdl,
        soap_v_1_2: false,
      });
    } catch (error) {
      if (error instanceof ErrorAfip && /no existe persona/i.test(error.message)) return null;
      throw error;
    }
    const p = r['personaReturn'] as Record<string, Record<string, unknown> | undefined> | undefined;
    const g = p?.['datosGenerales'] ?? p?.['errorConstancia'];
    if (!p || !g) return null;
    const nombre =
      typeof g['razonSocial'] === 'string'
        ? g['razonSocial']
        : [g['apellido'], g['nombre']].filter((x) => typeof x === 'string').join(' ');
    const impuestos = comoLista(
      p['datosRegimenGeneral']?.['impuesto'] as
        Record<string, unknown> | Record<string, unknown>[] | undefined,
    ).map((i) => Number(i['idImpuesto']));
    const condicion: PersonaPadron['condicion'] = p['datosMonotributo']
      ? 'monotributo'
      : impuestos.includes(30)
        ? 'responsable_inscripto'
        : impuestos.includes(32)
          ? 'exento'
          : 'consumidor_final';
    const d = (g['domicilioFiscal'] ?? {}) as Record<string, unknown>;
    const partes = [d['direccion'], d['localidad'], d['descripcionProvincia']].filter(
      (x): x is string => typeof x === 'string' && x.trim() !== '',
    );
    const cp = typeof d['codPostal'] === 'string' ? ` (${d['codPostal']})` : '';
    return {
      cuit,
      nombre: nombre.trim().slice(0, 80),
      condicion,
      domicilio: partes.length ? `${partes.join(', ')}${cp}`.slice(0, 200) : null,
      activa: g['estadoClave'] === undefined || g['estadoClave'] === 'ACTIVO',
    };
  }

  /** Estado de los servidores de ARCA. Que diga "OK" no asegura que facturar ande. */
  async estado(): Promise<{ app: string; base: string; autenticacion: string }> {
    const r = await this.wsfe(null, 'FEDummy');
    return {
      app: String(r['AppServer']),
      base: String(r['DbServer']),
      autenticacion: String(r['AuthServer']),
    };
  }

  async ultimoAutorizado(cuit: string, puntoDeVenta: number, tipo: number): Promise<number> {
    const r = await this.wsfe(cuit, 'FECompUltimoAutorizado', {
      PtoVta: puntoDeVenta,
      CbteTipo: tipo,
    });
    return Number(r['CbteNro']);
  }

  /** Puntos de venta habilitados para web services de ese CUIT. */
  async puntosDeVenta(cuit: string) {
    const r = await this.wsfe(cuit, 'FEParamGetPtosVenta');
    const lista = comoLista(
      (
        r['ResultGet'] as
          { PtoVenta?: Record<string, unknown> | Record<string, unknown>[] } | undefined
      )?.PtoVenta,
    );
    return lista.map((p) => ({
      numero: Number(p['Nro']),
      tipo: String(p['EmisionTipo'] ?? ''),
      bloqueado: p['Bloqueado'] === 'S',
      baja: p['FchBaja'] && p['FchBaja'] !== 'NULL' ? String(p['FchBaja']) : null,
    }));
  }

  /** Pide el CAE de un comprobante. Si ARCA lo rechaza, tira `ErrorAfip` de tipo `arca`. */
  async solicitarCae(cuit: string, d: DetalleComprobante): Promise<Cae> {
    const { CbteTipo, PtoVta, Iva, CbtesAsoc, ...resto } = conNumeros(d) as DetalleComprobante;
    const detalle = {
      ...resto,
      ...(Iva ? { Iva: { AlicIva: Iva } } : {}),
      ...(CbtesAsoc ? { CbtesAsoc: { CbteAsoc: CbtesAsoc } } : {}),
    };
    const r = await this.wsfe(cuit, 'FECAESolicitar', {
      FeCAEReq: {
        FeCabReq: { CantReg: Number(d.CbteHasta) - Number(d.CbteDesde) + 1, PtoVta, CbteTipo },
        FeDetReq: { FECAEDetRequest: detalle },
      },
    });
    const [resp] = comoLista(
      (
        r['FeDetResp'] as
          { FECAEDetResponse?: Record<string, unknown> | Record<string, unknown>[] } | undefined
      )?.FECAEDetResponse,
    );
    const observaciones = comoLista(
      (resp?.['Observaciones'] as { Obs?: ErrorArca | ErrorArca[] } | undefined)?.Obs,
    ).map((o) => ({ codigo: Number(o.Code), mensaje: o.Msg }));
    if (!resp || resp['Resultado'] !== 'A' || !resp['CAE']) {
      const o = observaciones[0];
      throw new ErrorAfip(
        'arca',
        o ? `(${o.codigo}) ${o.mensaje}` : 'ARCA rechazó el comprobante.',
        o?.codigo ?? null,
      );
    }
    const vto = String(resp['CAEFchVto']);
    return {
      cae: String(resp['CAE']),
      vencimiento: `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}`,
      observaciones,
    };
  }

  /**
   * Próximo número y fecha mínima de un comprobante. ARCA exige que número y fecha vayan en
   * orden: la fecha no puede ser anterior a la del último autorizado.
   */
  async proximo(
    cuit: string,
    puntoDeVenta: number,
    tipo: number,
  ): Promise<{ numero: number; fechaMinima: string | null }> {
    const ultimo = await this.ultimoAutorizado(cuit, puntoDeVenta, tipo);
    if (ultimo < 1) return { numero: 1, fechaMinima: null };
    const previo = await this.consultar(cuit, puntoDeVenta, tipo, ultimo);
    const f = String(previo?.['CbteFch'] ?? '');
    return {
      numero: ultimo + 1,
      fechaMinima: /^\d{8}$/.test(f) ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : null,
    };
  }

  /** Un comprobante ya autorizado, o null si no existe (código 602 de ARCA). */
  async consultar(cuit: string, puntoDeVenta: number, tipo: number, numero: number) {
    try {
      const r = await this.wsfe(cuit, 'FECompConsultar', {
        FeCompConsReq: { CbteNro: numero, PtoVta: puntoDeVenta, CbteTipo: tipo },
      });
      return (r['ResultGet'] as Record<string, unknown> | undefined) ?? null;
    } catch (error) {
      if (error instanceof ErrorAfip && error.codigo === 602) return null;
      throw error;
    }
  }
}
