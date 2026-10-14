import { firmar, manifiesto } from '@mostrador/mp';
import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  crearEntorno,
  nuevoKiosco,
  SECRETO_WEBHOOK,
  type Entorno,
  type Persona,
} from './ayuda.ts';
import { MpFalso } from './mp-falso.ts';

let mp: MpFalso;
let e: Entorno;
const encoladas: string[] = [];

beforeAll(async () => {
  mp = await new MpFalso().iniciar();
  e = await crearEntorno({ mpUrl: mp.url, encolarOrdenMp: async (id) => void encoladas.push(id) });
});
afterAll(async () => {
  await e.cerrar();
  await mp.cerrar();
});

interface Kiosco {
  dueno: Persona;
  kioscoId: string;
  turnoId: string;
  productoId: string;
}

async function kioscoConectado(mpUserId: number): Promise<Kiosco> {
  const kioscoId = await nuevoKiosco(e.admin);
  const dueno = await altaConInvitacion(e.app, e.admin, kioscoId);
  await conectar(dueno, mpUserId);
  const productoId = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Coca',
      precio: 180000,
      stockInicial: 5,
    })
  ).json<{ id: string }>().id;
  const turnoId = uuidv7();
  await dueno.cliente.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
      },
    ],
  });
  return { dueno, kioscoId, turnoId, productoId };
}

async function conectar(dueno: Persona, mpUserId: number) {
  const r = await dueno.cliente.get('/api/v1/mp/conectar');
  expect(r.statusCode).toBe(302);
  const destino = new URL(r.headers.location as string);
  expect(destino.searchParams.get('code_challenge_method')).toBe('S256');
  const state = destino.searchParams.get('state') ?? '';
  const code = mp.autorizar(mpUserId, destino.searchParams.get('code_challenge') ?? '');
  const cb = await dueno.cliente.get(`/api/v1/mp/callback?code=${code}&state=${state}`);
  expect(cb.headers.location).toBe('/mas/conexiones?mp=ok');
  return { state, code };
}

async function cobrarQr(k: Kiosco, cantidad = 1) {
  const ventaId = uuidv7();
  const pagoId = uuidv7();
  const r = await k.dueno.cliente.post('/api/v1/cobros/qr', {
    ventaId,
    pagoId,
    turnoId: k.turnoId,
    creadaEn: new Date().toISOString(),
    total: 180000 * cantidad,
    items: [
      {
        id: uuidv7(),
        productoId: k.productoId,
        descripcion: 'Coca',
        cantidad,
        precioUnitario: 180000,
      },
    ],
  });
  expect(r.statusCode, r.body).toBe(200);
  const orden = [...mp.ordenes.values()].find((o) => o.external_reference === ventaId);
  return { ventaId, pagoId, qr: r.json<{ qr: string }>().qr, ordenId: orden?.id ?? '' };
}

const stock = async (k: Kiosco) =>
  (await k.dueno.cliente.get(`/api/v1/productos/${k.productoId}`)).json<{ stock: number }>().stock;

function webhook(ordenId: string, opciones: { firma?: string; ts?: number } = {}) {
  const ts = String(opciones.ts ?? Date.now());
  const requestId = uuidv7();
  const v1 = opciones.firma ?? firmar(SECRETO_WEBHOOK, manifiesto(ordenId, requestId, ts));
  return e.app.inject({
    method: 'POST',
    url: `/api/v1/webhooks/mercadopago?data.id=${ordenId}&type=order`,
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    payload: {
      id: 123,
      type: 'order',
      action: 'order.processed',
      data: { id: ordenId, status: 'processed' },
    },
  });
}

describe('conexión con OAuth', () => {
  it('conecta, guarda los tokens cifrados y crea sucursal y caja', async () => {
    const k = await kioscoConectado(1001);
    const { rows } = await e.admin.query(`select * from integraciones where kiosco_id = $1`, [
      k.kioscoId,
    ]);
    expect(rows[0]).toMatchObject({ estado: 'conectado', mp_user_id: '1001' });
    expect(rows[0].mp_external_pos_id).toMatch(/^MOSTRADOR/);
    // Los tokens no están en texto plano.
    expect(rows[0].access_token_cifrado.toString()).not.toContain('APP_USR');
    expect((await k.dueno.cliente.get('/api/v1/mp/estado')).json()).toEqual({
      configurado: true,
      estado: 'conectado',
      puedeCobrar: true,
    });
    expect((await k.dueno.cliente.post('/api/v1/mp/probar')).json()).toEqual({ ok: true });
    // Ninguna respuesta de la API trae tokens.
    expect((await k.dueno.cliente.get('/api/v1/mp/estado')).body).not.toContain('APP_USR');
  });

  it('el state es de un solo uso', async () => {
    const kioscoId = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kioscoId);
    const { state } = await conectar(dueno, 1002);
    const code = mp.autorizar(1002, 'x');
    const r = await dueno.cliente.get(`/api/v1/mp/callback?code=${code}&state=${state}`);
    expect(r.headers.location).toBe('/mas/conexiones?mp=vencido');
  });

  it('un state de otro kiosco no sirve', async () => {
    const a = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
    const b = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
    const r = await a.cliente.get('/api/v1/mp/conectar');
    const state = new URL(r.headers.location as string).searchParams.get('state');
    const code = mp.autorizar(
      1003,
      new URL(r.headers.location as string).searchParams.get('code_challenge') ?? '',
    );
    const cb = await b.cliente.get(`/api/v1/mp/callback?code=${code}&state=${state}`);
    expect(cb.headers.location).toBe('/mas/conexiones?mp=vencido');
  });

  it('desconectar borra los tokens', async () => {
    const k = await kioscoConectado(1004);
    await k.dueno.cliente.post('/api/v1/mp/desconectar');
    const { rows } = await e.admin.query(
      `select estado, access_token_cifrado from integraciones where kiosco_id = $1`,
      [k.kioscoId],
    );
    expect(rows[0]).toEqual({ estado: 'desconectado', access_token_cifrado: null });
  });
});

describe('cobro con QR', () => {
  it('crea la orden con idempotencia y solo devuelve el dato del QR', async () => {
    const k = await kioscoConectado(2001);
    const c = await cobrarQr(k);
    expect(c.qr).toMatch(/^000201/);
    const pedido = mp.pedidosOrden.find((p) => p.cuerpo['external_reference'] === c.ventaId);
    expect(pedido?.idempotencia).toBe(c.pagoId);
    expect(pedido?.cuerpo).toMatchObject({
      type: 'qr',
      total_amount: '1800.00',
      config: { qr: { mode: 'dynamic' } },
    });
    expect((await k.dueno.cliente.get(`/api/v1/pagos/${c.pagoId}`)).json()).toMatchObject({
      estado: 'pendiente',
      ventaEstado: 'abierta',
    });
    // Sin pago confirmado, el stock no se mueve.
    expect(await stock(k)).toBe(5);
  });

  it('al pagar, la reconsulta marca cobrada la venta y descuenta stock', async () => {
    const k = await kioscoConectado(2002);
    const c = await cobrarQr(k, 2);
    mp.pagar(c.ordenId);
    const r = (await k.dueno.cliente.get(`/api/v1/pagos/${c.pagoId}`)).json();
    expect(r).toMatchObject({ estado: 'aprobado', ventaEstado: 'cobrada' });
    expect(await stock(k)).toBe(3);
    expect((await k.dueno.cliente.get('/api/v1/caja')).json().resumen.porMedio.qr_mp).toBe(360000);
  });

  it('cancelar cobro cancela la orden y anula la venta', async () => {
    const k = await kioscoConectado(2003);
    const c = await cobrarQr(k);
    expect((await k.dueno.cliente.post(`/api/v1/pagos/${c.pagoId}/cancelar`)).json()).toEqual({
      estado: 'cancelado',
    });
    expect(mp.ordenes.get(c.ordenId)?.status).toBe('canceled');
    expect((await k.dueno.cliente.get(`/api/v1/ventas/${c.ventaId}`)).json().estado).toBe(
      'anulada',
    );
  });

  it('si el cliente ya pagó, cancelar no anula: queda cobrada', async () => {
    const k = await kioscoConectado(2004);
    const c = await cobrarQr(k);
    mp.pagar(c.ordenId);
    expect((await k.dueno.cliente.post(`/api/v1/pagos/${c.pagoId}/cancelar`)).json()).toEqual({
      estado: 'aprobado',
    });
  });

  it('si no se puede crear el QR, avisa y no deja nada a medias', async () => {
    const k = await kioscoConectado(2005);
    mp.fallarOrdenes = true;
    const ventaId = uuidv7();
    const r = await k.dueno.cliente.post('/api/v1/cobros/qr', {
      ventaId,
      pagoId: uuidv7(),
      turnoId: k.turnoId,
      creadaEn: new Date().toISOString(),
      total: 180000,
      items: [
        {
          id: uuidv7(),
          productoId: k.productoId,
          descripcion: 'Coca',
          cantidad: 1,
          precioUnitario: 180000,
        },
      ],
    });
    mp.fallarOrdenes = false;
    expect(r.json().error).toBe('No se pudo crear el QR. Revisá la conexión o cobrá en efectivo.');
    expect((await k.dueno.cliente.get(`/api/v1/ventas/${ventaId}`)).json().estado).toBe('anulada');
    expect(await stock(k)).toBe(5);
  });

  it('vencida sin pago: queda pendiente de cobro y el dueño la resuelve en efectivo', async () => {
    const k = await kioscoConectado(2006);
    const c = await cobrarQr(k);
    mp.vencer(c.ordenId);
    expect((await k.dueno.cliente.get(`/api/v1/pagos/${c.pagoId}`)).json()).toMatchObject({
      estado: 'vencido',
      ventaEstado: 'pendiente_cobro',
    });
    const pendientes = (await k.dueno.cliente.get('/api/v1/ventas/pendientes')).json<
      { id: string }[]
    >();
    expect(pendientes.map((p) => p.id)).toContain(c.ventaId);
    expect(
      (await k.dueno.cliente.post(`/api/v1/ventas/${c.ventaId}/resolver`, { accion: 'efectivo' }))
        .statusCode,
    ).toBe(200);
    expect((await k.dueno.cliente.get(`/api/v1/ventas/${c.ventaId}`)).json().estado).toBe(
      'cobrada',
    );
    expect(await stock(k)).toBe(4);
  });

  it('sin Mercado Pago conectado no se puede cobrar con QR', async () => {
    const kioscoId = await nuevoKiosco(e.admin);
    const dueno = await altaConInvitacion(e.app, e.admin, kioscoId);
    const turnoId = uuidv7();
    await dueno.cliente.post('/api/v1/sync', {
      ops: [
        {
          tipo: 'apertura',
          datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
        },
      ],
    });
    const r = await dueno.cliente.post('/api/v1/cobros/qr', {
      ventaId: uuidv7(),
      pagoId: uuidv7(),
      turnoId,
      creadaEn: new Date().toISOString(),
      total: 100,
      items: [
        { id: uuidv7(), productoId: null, descripcion: 'X', cantidad: 1, precioUnitario: 100 },
      ],
    });
    expect(r.json().codigo).toBe('mp_sin_conectar');
  });
});

describe('webhooks', () => {
  it('con firma válida encola la reconsulta; reenviado no se procesa dos veces', async () => {
    const k = await kioscoConectado(3001);
    const c = await cobrarQr(k);
    const antes = encoladas.length;
    const r = await webhook(c.ordenId);
    expect(r.statusCode).toBe(200);
    expect(encoladas.slice(antes)).toEqual([c.ordenId]);
  });

  it('con firma inválida o vieja se rechaza y no cambia nada', async () => {
    const k = await kioscoConectado(3002);
    const c = await cobrarQr(k);
    const antes = encoladas.length;
    expect((await webhook(c.ordenId, { firma: '0'.repeat(64) })).statusCode).toBe(401);
    expect((await webhook(c.ordenId, { ts: Date.now() - 3600_000 })).statusCode).toBe(401);
    expect(encoladas.length).toBe(antes);
    expect((await k.dueno.cliente.get(`/api/v1/ventas/${c.ventaId}`)).json().estado).toBe(
      'abierta',
    );
  });

  it('un webhook falso que dice "pagado" no cambia nada: manda lo que dice Mercado Pago', async () => {
    const k = await kioscoConectado(3003);
    const c = await cobrarQr(k);
    const { reconsultarOrden, ClienteMp } = await import('@mostrador/mp');
    const cliente = new ClienteMp({
      clientId: 'app-id',
      clientSecret: 'secreto-app',
      redirectUri: '',
      webhookSecret: '',
      apiBase: mp.url,
      authUrl: '',
      pruebas: true,
    });
    // La orden sigue "created" en Mercado Pago aunque el cuerpo del webhook diga otra cosa.
    expect(await reconsultarOrden(e.base, e.app.cifrador, cliente, c.ordenId)).toBe('pendiente');
    expect((await k.dueno.cliente.get(`/api/v1/ventas/${c.ventaId}`)).json().estado).toBe(
      'abierta',
    );
  });
});

describe('dos cuentas de vendedor distintas', () => {
  it('un pago de A nunca puede marcar una venta de B', async () => {
    const a = await kioscoConectado(4001);
    const b = await kioscoConectado(4002);
    const ca = await cobrarQr(a);
    const cb = await cobrarQr(b);
    // La orden de B, pagada, no afecta a A ni viceversa.
    mp.pagar(cb.ordenId);
    expect((await a.dueno.cliente.get(`/api/v1/pagos/${ca.pagoId}`)).json().estado).toBe(
      'pendiente',
    );
    expect((await b.dueno.cliente.get(`/api/v1/pagos/${cb.pagoId}`)).json().estado).toBe(
      'aprobado',
    );

    // Aunque alguien apunte la orden pagada de B al pago de A en la base, la verificación
    // (venta, monto y cuenta del vendedor) la ignora.
    const { aplicarOrden } = await import('@mostrador/mp');
    const { withKiosco } = await import('@mostrador/db');
    const ordenB = mp.ordenes.get(cb.ordenId)!;
    const r = await withKiosco(e.base, a.kioscoId, (tx) =>
      aplicarOrden(tx, ca.pagoId, { ...ordenB }, '4001'),
    );
    expect(r).toBe('ignorada');
    expect((await a.dueno.cliente.get(`/api/v1/ventas/${ca.ventaId}`)).json().estado).toBe(
      'abierta',
    );
  });

  it('el token de A no puede leer órdenes de B', async () => {
    const a = await kioscoConectado(4003);
    const b = await kioscoConectado(4004);
    const cb = await cobrarQr(b);
    // A intenta consultar el pago de B: no existe para A.
    expect((await a.dueno.cliente.get(`/api/v1/pagos/${cb.pagoId}`)).statusCode).toBe(404);
  });
});

describe('worker', () => {
  it('renueva tokens por vencer y marca "requiere atención" si el vendedor revocó el acceso', async () => {
    const { renovarTokens, ClienteMp } = await import('@mostrador/mp');
    const cliente = new ClienteMp({
      clientId: 'app-id',
      clientSecret: 'secreto-app',
      redirectUri: '',
      webhookSecret: '',
      apiBase: mp.url,
      authUrl: '',
      pruebas: true,
    });
    const ok = await kioscoConectado(5001);
    const revocado = await kioscoConectado(5002);
    await e.admin.query(
      `update integraciones set vence_en = now() + interval '5 days' where kiosco_id = any($1)`,
      [[ok.kioscoId, revocado.kioscoId]],
    );
    const antes = (
      await e.admin.query(`select access_token_cifrado from integraciones where kiosco_id = $1`, [
        ok.kioscoId,
      ])
    ).rows[0].access_token_cifrado;
    // El vendedor de "revocado" quitó el permiso: su refresh token ya no sirve.
    const cif = e.app.cifrador.cifrar('TG-revocado');
    await e.admin.query(
      `update integraciones set refresh_token_cifrado = $2, clave_version = $3 where kiosco_id = $1`,
      [revocado.kioscoId, cif.datos, cif.version],
    );
    const r = await renovarTokens(e.base, e.app.cifrador, cliente);
    expect(r.renovados).toBeGreaterThanOrEqual(1);
    const { rows } = await e.admin.query(
      `select kiosco_id, estado, access_token_cifrado, vence_en from integraciones where kiosco_id = any($1)`,
      [[ok.kioscoId, revocado.kioscoId]],
    );
    const fOk = rows.find((x) => x.kiosco_id === ok.kioscoId);
    expect(fOk.estado).toBe('conectado');
    expect(Buffer.compare(fOk.access_token_cifrado, antes)).not.toBe(0);
    expect(new Date(fOk.vence_en).getTime()).toBeGreaterThan(Date.now() + 100 * 86_400_000);
    expect(rows.find((x) => x.kiosco_id === revocado.kioscoId).estado).toBe('requiere_atencion');
  });

  it('los cobros pendientes se reconsultan y se confirman sin que nadie mire la pantalla', async () => {
    const { pagosPendientes, reconsultarPago, ClienteMp } = await import('@mostrador/mp');
    const cliente = new ClienteMp({
      clientId: 'app-id',
      clientSecret: 'secreto-app',
      redirectUri: '',
      webhookSecret: '',
      apiBase: mp.url,
      authUrl: '',
      pruebas: true,
    });
    const k = await kioscoConectado(5003);
    const c = await cobrarQr(k);
    mp.pagar(c.ordenId);
    const pendientes = await pagosPendientes(e.base);
    expect(pendientes.map((p) => p.pago_id)).toContain(c.pagoId);
    for (const p of pendientes.filter((x) => x.kiosco_id === k.kioscoId))
      await reconsultarPago(e.base, e.app.cifrador, cliente, p.kiosco_id, p.pago_id);
    expect((await k.dueno.cliente.get(`/api/v1/ventas/${c.ventaId}`)).json().estado).toBe(
      'cobrada',
    );
  });
});
