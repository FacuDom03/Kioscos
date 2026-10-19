// Cliente de Afip SDK contra un servidor falso: forma de los pedidos, permiso guardado y errores.
import { describe, expect, it } from 'vitest';
import { ClienteAfipSdk, ErrorAfip } from '../src/index.ts';

type Pedido = { url: string; cuerpo: Record<string, unknown>; cabeceras: Record<string, string> };

function falso(responder: (p: Pedido) => { status?: number; json: unknown } | 'cortar') {
  const pedidos: Pedido[] = [];
  const fetchFalso = (async (url: string, init: RequestInit) => {
    const p = {
      url,
      cuerpo: JSON.parse(String(init.body)) as Record<string, unknown>,
      cabeceras: init.headers as Record<string, string>,
    };
    pedidos.push(p);
    const r = responder(p);
    if (r === 'cortar') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { pedidos, fetchFalso };
}

const PERMISO = {
  token: 'tok',
  sign: 'firma',
  expiration: new Date(Date.now() + 12 * 3600_000).toISOString(),
};

describe('cliente de Afip SDK', () => {
  it('pide el permiso una sola vez y lo usa en cada pedido, con el CUIT del comercio', async () => {
    const { pedidos, fetchFalso } = falso((p) =>
      p.url.endsWith('v1/afip/auth')
        ? { json: PERMISO }
        : { json: { FECompUltimoAutorizadoResult: { CbteNro: 41 } } },
    );
    const c = new ClienteAfipSdk({
      accessToken: 'secreto',
      produccion: false,
      fetch: fetchFalso,
      cert: 'C',
      key: 'K',
    });
    expect(await c.ultimoAutorizado('20409378472', 3, 11)).toBe(41);
    expect(await c.ultimoAutorizado('20409378472', 3, 11)).toBe(41);
    expect(pedidos.map((p) => p.url.replace('https://app.afipsdk.com/api/', ''))).toEqual([
      'v1/afip/auth',
      'v1/afip/requests',
      'v1/afip/requests',
    ]);
    expect(pedidos[0]!.cuerpo).toEqual({
      environment: 'dev',
      wsid: 'wsfe',
      tax_id: 20409378472,
      force_create: false,
      cert: 'C',
      key: 'K',
    });
    expect(pedidos[0]!.cabeceras['authorization']).toBe('Bearer secreto');
    expect(pedidos[1]!.cuerpo).toMatchObject({
      method: 'FECompUltimoAutorizado',
      wsid: 'wsfe',
      url: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
      params: { PtoVta: 3, CbteTipo: 11 },
    });
    expect((pedidos[1]!.cuerpo['params'] as { Auth: unknown }).Auth).toEqual({
      Token: 'tok',
      Sign: 'firma',
      Cuit: 20409378472,
    });
  });

  it('pide el CAE con el formato de ARCA y devuelve el CAE y su vencimiento', async () => {
    const { pedidos, fetchFalso } = falso((p) =>
      p.url.endsWith('v1/afip/auth')
        ? { json: PERMISO }
        : {
            json: {
              FECAESolicitarResult: {
                FeDetResp: {
                  FECAEDetResponse: [
                    { Resultado: 'A', CAE: '76123456789012', CAEFchVto: '20261029' },
                  ],
                },
              },
            },
          },
    );
    const c = new ClienteAfipSdk({ accessToken: 'x', produccion: true, fetch: fetchFalso });
    const r = await c.solicitarCae('20409378472', {
      CbteTipo: 6,
      PtoVta: 3,
      CbteDesde: 7,
      CbteHasta: 7,
      ImpTotal: '121.00',
      CbteFch: '20261019',
      MonId: 'PES',
      Iva: [{ Id: 5, BaseImp: '100.00', Importe: '21.00' }],
    });
    expect(r).toEqual({ cae: '76123456789012', vencimiento: '2026-10-29', observaciones: [] });
    expect(pedidos[1]!.cuerpo['url']).toBe('https://servicios1.afip.gov.ar/wsfev1/service.asmx');
    expect((pedidos[1]!.cuerpo['params'] as { FeCAEReq: unknown }).FeCAEReq).toEqual({
      FeCabReq: { CantReg: 1, PtoVta: 3, CbteTipo: 6 },
      FeDetReq: {
        FECAEDetRequest: {
          CbteDesde: 7,
          CbteHasta: 7,
          ImpTotal: 121,
          CbteFch: 20261019,
          MonId: 'PES',
          Iva: { AlicIva: [{ Id: 5, BaseImp: 100, Importe: 21 }] },
        },
      },
    });
  });

  it('distingue un rechazo de ARCA, un error de Afip SDK y la falta de respuesta', async () => {
    const rechazo = falso((p) =>
      p.url.endsWith('v1/afip/auth')
        ? { json: PERMISO }
        : {
            json: {
              FECAESolicitarResult: {
                FeDetResp: {
                  FECAEDetResponse: {
                    Resultado: 'R',
                    Observaciones: { Obs: { Code: 10016, Msg: 'El número no es el próximo' } },
                  },
                },
              },
            },
          },
    );
    const datos = { CbteTipo: 11, PtoVta: 3, CbteDesde: 9, CbteHasta: 9 };
    await expect(
      new ClienteAfipSdk({
        accessToken: 'x',
        produccion: false,
        fetch: rechazo.fetchFalso,
      }).solicitarCae('20409378472', datos),
    ).rejects.toMatchObject({ tipo: 'arca', codigo: 10016 });

    const caido = falso(() => ({ status: 502, json: { message: 'ARCA no responde' } }));
    const e = await new ClienteAfipSdk({
      accessToken: 'x',
      produccion: false,
      fetch: caido.fetchFalso,
    })
      .estado()
      .catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ErrorAfip);
    expect(e).toMatchObject({ tipo: 'servicio', status: 502 });

    const cortado = falso(() => 'cortar');
    await expect(
      new ClienteAfipSdk({
        accessToken: 'x',
        produccion: false,
        fetch: cortado.fetchFalso,
      }).estado(),
    ).rejects.toMatchObject({ tipo: 'red' });
  });

  it('el próximo comprobante trae la fecha mínima (la del último autorizado)', async () => {
    const { fetchFalso } = falso((p) => {
      if (p.url.endsWith('v1/afip/auth')) return { json: PERMISO };
      if (p.cuerpo['method'] === 'FECompUltimoAutorizado')
        return { json: { FECompUltimoAutorizadoResult: { CbteNro: 16446 } } };
      return { json: { FECompConsultarResult: { ResultGet: { CbteFch: '20261021' } } } };
    });
    const c = new ClienteAfipSdk({ accessToken: 'x', produccion: false, fetch: fetchFalso });
    expect(await c.proximo('20409378472', 1, 11)).toEqual({
      numero: 16447,
      fechaMinima: '2026-10-21',
    });
  });

  it('un comprobante que no existe da null (código 602), sin error', async () => {
    const { fetchFalso } = falso((p) =>
      p.url.endsWith('v1/afip/auth')
        ? { json: PERMISO }
        : {
            json: {
              FECompConsultarResult: { Errors: { Err: { Code: 602, Msg: 'Sin resultados' } } },
            },
          },
    );
    const c = new ClienteAfipSdk({ accessToken: 'x', produccion: false, fetch: fetchFalso });
    expect(await c.consultar('20409378472', 3, 11, 999)).toBeNull();
  });
});
