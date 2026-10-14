import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  nuevoKiosco,
  type Cliente,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;

beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

interface Contexto {
  dueno: Persona;
  turnoId: string;
  coca: string;
  alfajor: string;
}

async function preparar(): Promise<Contexto> {
  const dueno = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
  const coca = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Coca',
      precio: 180000,
      stockInicial: 10,
    })
  ).json<{ id: string }>().id;
  const alfajor = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Alfajor',
      precio: 120000,
      stockInicial: 1,
    })
  ).json<{ id: string }>().id;
  const turnoId = uuidv7();
  const r = await dueno.cliente.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 1000000, abiertoEn: new Date().toISOString() },
      },
    ],
  });
  expect(r.json().resultados[0]).toMatchObject({ estado: 'ok', turnoId });
  return { dueno, turnoId, coca, alfajor };
}

function venta(
  c: Contexto,
  items: { productoId: string | null; cantidad: number; precio: number; descripcion?: string }[],
  medio: 'efectivo' | 'transferencia' = 'efectivo',
  recibido?: number,
) {
  const total = items.reduce((t, i) => t + Math.round(i.cantidad * i.precio), 0);
  return {
    tipo: 'venta',
    datos: {
      id: uuidv7(),
      turnoId: c.turnoId,
      creadaEn: new Date().toISOString(),
      total,
      items: items.map((i) => ({
        id: uuidv7(),
        productoId: i.productoId,
        descripcion: i.descripcion ?? 'Producto',
        cantidad: i.cantidad,
        precioUnitario: i.precio,
      })),
      pagos: [
        { id: uuidv7(), medio, monto: total, ...(recibido !== undefined ? { recibido } : {}) },
      ],
    },
  };
}

const sync = (cliente: Cliente, ops: unknown[]) => cliente.post('/api/v1/sync', { ops });
const stockDe = async (cliente: Cliente, id: string) =>
  (await cliente.get(`/api/v1/productos/${id}`)).json<{ stock: number }>().stock;

describe('ventas', () => {
  it('una venta en efectivo guarda ítems, pagos y descuenta stock en una sola transacción', async () => {
    const c = await preparar();
    const op = venta(c, [{ productoId: c.coca, cantidad: 2, precio: 180000 }], 'efectivo', 500000);
    const r = await sync(c.dueno.cliente, [op]);
    expect(r.json().resultados).toEqual([{ id: op.datos.id, estado: 'ok' }]);
    expect(await stockDe(c.dueno.cliente, c.coca)).toBe(8);
    const v = (await c.dueno.cliente.get(`/api/v1/ventas/${op.datos.id}`)).json();
    expect(v).toMatchObject({
      estado: 'cobrada',
      total: 360000,
      pagos: [{ medio: 'efectivo', recibido: 500000, vuelto: 140000 }],
    });
  });

  it('reenviar el mismo lote no duplica nada', async () => {
    const c = await preparar();
    const ops = [venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }])];
    await sync(c.dueno.cliente, ops);
    const r = await sync(c.dueno.cliente, ops);
    expect(r.json().resultados[0].estado).toBe('ya_existia');
    expect(await stockDe(c.dueno.cliente, c.coca)).toBe(9);
    expect((await c.dueno.cliente.get('/api/v1/ventas')).json()).toHaveLength(1);
  });

  it('el stock puede quedar negativo: se avisa pero la venta se guarda', async () => {
    const c = await preparar();
    const r = await sync(c.dueno.cliente, [
      venta(c, [{ productoId: c.alfajor, cantidad: 3, precio: 120000, descripcion: 'Alfajor' }]),
    ]);
    expect(r.json().resultados[0]).toMatchObject({
      estado: 'ok',
      avisos: [{ productoId: c.alfajor, nombre: 'Alfajor', stock: -2 }],
    });
  });

  it('una operación mala no frena a las demás y no deja nada a medias', async () => {
    const c = await preparar();
    const mala = venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }]);
    mala.datos.total = 1; // no coincide
    const buena = venta(
      c,
      [{ productoId: null, cantidad: 1, precio: 50000, descripcion: 'Precio libre' }],
      'transferencia',
    );
    const r = (await sync(c.dueno.cliente, [mala, buena])).json<{
      resultados: { estado: string }[];
    }>();
    expect(r.resultados.map((x) => x.estado)).toEqual(['rechazada', 'ok']);
    expect(await stockDe(c.dueno.cliente, c.coca)).toBe(10);
  });

  it('un campo de más en una operación la rechaza', async () => {
    const c = await preparar();
    const op = venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }]) as {
      tipo: string;
      datos: Record<string, unknown>;
    };
    op.datos['usuarioId'] = uuidv7();
    expect((await sync(c.dueno.cliente, [op])).json().resultados[0].estado).toBe('rechazada');
  });

  it('una venta de un equipo con el reloj atrasado se guarda con las dos horas', async () => {
    const c = await preparar();
    const op = venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }]);
    op.datos.creadaEn = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect((await sync(c.dueno.cliente, [op])).json().resultados[0].estado).toBe('ok');
    const v = (await c.dueno.cliente.get(`/api/v1/ventas/${op.datos.id}`)).json();
    expect(
      new Date(v.recibida_en).getTime() - new Date(v.creada_en_dispositivo).getTime(),
    ).toBeGreaterThan(2 * 86_400_000);
  });

  it('dos equipos vendiendo el último producto: las dos ventas quedan y el stock da negativo', async () => {
    const c = await preparar();
    const { cajero } = await cajeroEnEquipo(c.dueno, e.app);
    const r1 = await sync(c.dueno.cliente, [
      venta(c, [{ productoId: c.alfajor, cantidad: 1, precio: 120000, descripcion: 'Alfajor' }]),
    ]);
    const r2 = await sync(cajero, [
      venta(c, [{ productoId: c.alfajor, cantidad: 1, precio: 120000, descripcion: 'Alfajor' }]),
    ]);
    expect(r1.json().resultados[0]).toEqual(expect.objectContaining({ estado: 'ok' }));
    expect(r2.json().resultados[0]).toMatchObject({ estado: 'ok', avisos: [{ stock: -1 }] });
  });

  it('dos equipos abriendo la caja comparten el mismo turno', async () => {
    const c = await preparar();
    const r = await sync(c.dueno.cliente, [
      {
        tipo: 'apertura',
        datos: { id: uuidv7(), cambioInicial: 0, abiertoEn: new Date().toISOString() },
      },
    ]);
    expect(r.json().resultados[0]).toMatchObject({ estado: 'ok', turnoId: c.turnoId });
  });
});

describe('caja', () => {
  it('cierre: cambio + efectivo − gastos = debería haber, con la diferencia', async () => {
    const c = await preparar();
    await sync(c.dueno.cliente, [
      venta(c, [{ productoId: c.coca, cantidad: 5, precio: 180000 }]),
      venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }], 'transferencia'),
      {
        tipo: 'gasto',
        datos: {
          id: uuidv7(),
          turnoId: c.turnoId,
          tipo: 'gasto',
          monto: 250000,
          motivo: 'Bolsas',
          creadoEn: new Date().toISOString(),
        },
      },
      {
        tipo: 'gasto',
        datos: {
          id: uuidv7(),
          turnoId: c.turnoId,
          tipo: 'retiro',
          monto: 500000,
          motivo: 'Retiro del dueño',
          creadoEn: new Date().toISOString(),
        },
      },
    ]);
    const caja = (await c.dueno.cliente.get('/api/v1/caja')).json();
    expect(caja.resumen).toEqual({
      vendido: 1080000,
      ventas: 2,
      porMedio: { efectivo: 900000, qr_mp: 0, transferencia: 180000 },
      gastos: 250000,
      retiros: 500000,
      deberiaHaber: 1150000,
    });
    const cierre = (
      await c.dueno.cliente.post(`/api/v1/caja/turnos/${c.turnoId}/cerrar`, {
        contado: 1100000,
        nota: 'Faltó cambio',
      })
    ).json();
    expect(cierre).toMatchObject({ contado: 1100000, diferencia: -50000 });
    expect((await c.dueno.cliente.get('/api/v1/caja')).json()).toEqual({ turno: null });
    expect(
      (await c.dueno.cliente.post(`/api/v1/caja/turnos/${c.turnoId}/cerrar`, { contado: 0 }))
        .statusCode,
    ).toBe(409);
  });

  it('el cajero vende y cierra su caja, pero no ve cierres anteriores', async () => {
    const c = await preparar();
    const { cajero } = await cajeroEnEquipo(c.dueno, e.app);
    expect(
      (await sync(cajero, [venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }])])).json()
        .resultados[0].estado,
    ).toBe('ok');
    expect((await cajero.get('/api/v1/caja/cierres')).statusCode).toBe(403);
    expect(
      (await cajero.post(`/api/v1/caja/turnos/${c.turnoId}/cerrar`, { contado: 1180000 })).json()
        .diferencia,
    ).toBe(0);
  });
});

describe('anulación', () => {
  it('revierte el stock, pide motivo y queda auditada; la venta deja de contar en la caja', async () => {
    const c = await preparar();
    const op = venta(c, [{ productoId: c.coca, cantidad: 2, precio: 180000 }]);
    await sync(c.dueno.cliente, [op]);
    expect(
      (await c.dueno.cliente.post(`/api/v1/ventas/${op.datos.id}/anular`, { motivo: '' }))
        .statusCode,
    ).toBe(400);
    const r = await c.dueno.cliente.post(`/api/v1/ventas/${op.datos.id}/anular`, {
      motivo: 'Se equivocó de producto',
    });
    expect(r.json()).toEqual({ ok: true, devolucionPendiente: false });
    expect(await stockDe(c.dueno.cliente, c.coca)).toBe(10);
    expect((await c.dueno.cliente.get('/api/v1/caja')).json().resumen.vendido).toBe(0);
    expect(
      (await c.dueno.cliente.post(`/api/v1/ventas/${op.datos.id}/anular`, { motivo: 'Otra vez' }))
        .statusCode,
    ).toBe(409);
    const audit = (await c.dueno.cliente.get('/api/v1/auditoria')).json<{ accion: string }[]>();
    expect(audit.map((a) => a.accion)).toContain('venta.anulada');
  });

  it('el cajero no puede anular', async () => {
    const c = await preparar();
    const { cajero } = await cajeroEnEquipo(c.dueno, e.app);
    const op = venta(c, [{ productoId: c.coca, cantidad: 1, precio: 180000 }]);
    await sync(cajero, [op]);
    expect(
      (await cajero.post(`/api/v1/ventas/${op.datos.id}/anular`, { motivo: 'Quiero' })).statusCode,
    ).toBe(403);
  });
});
