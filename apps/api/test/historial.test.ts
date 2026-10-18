import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
} from './ayuda.ts';

let e: Entorno;
beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

/** Comercio con una compra, una venta, un gasto y la caja cerrada. */
async function comercioConMovimientos() {
  const dueno = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin));
  const producto = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Yerba 1 kg',
      precio: 400000,
      stockInicial: 5,
    })
  ).json<{ id: string }>().id;
  const compra = (
    await dueno.cliente.post('/api/v1/compras', {
      items: [{ productoId: producto, cantidad: 10, costoUnitario: 300000 }],
      nota: 'Distribuidora Sur',
    })
  ).json<{ id: string }>().id;
  const turnoId = uuidv7();
  await dueno.cliente.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 1000000, abiertoEn: new Date().toISOString() },
      },
      {
        tipo: 'venta',
        datos: {
          id: uuidv7(),
          turnoId,
          creadaEn: new Date().toISOString(),
          total: 800000,
          items: [
            {
              id: uuidv7(),
              productoId: producto,
              descripcion: 'Yerba 1 kg',
              cantidad: 2,
              precioUnitario: 400000,
            },
          ],
          pagos: [{ id: uuidv7(), medio: 'efectivo', monto: 800000 }],
        },
      },
      {
        tipo: 'gasto',
        datos: {
          id: uuidv7(),
          turnoId,
          tipo: 'gasto',
          monto: 150000,
          motivo: 'Bolsas',
          creadoEn: new Date().toISOString(),
        },
      },
    ],
  });
  await dueno.cliente.post(`/api/v1/caja/turnos/${turnoId}/cerrar`, { contado: 1650000 });
  return { dueno, producto, compra, turnoId };
}

describe('historial', () => {
  it('compras con su detalle', async () => {
    const { dueno, compra } = await comercioConMovimientos();
    const lista = (await dueno.cliente.get('/api/v1/compras')).json<
      { id: string; productos: number; total: number }[]
    >();
    expect(lista).toMatchObject([{ id: compra, productos: 1, total: 3000000 }]);
    const d = (await dueno.cliente.get(`/api/v1/compras/${compra}`)).json<{
      nota: string;
      items: { nombre: string; cantidad: number; costo_unitario: number }[];
    }>();
    expect(d.nota).toBe('Distribuidora Sur');
    expect(d.items).toMatchObject([{ nombre: 'Yerba 1 kg', cantidad: 10, costo_unitario: 300000 }]);
  });

  it('movimientos de stock de un producto, del más nuevo al más viejo', async () => {
    const { dueno, producto } = await comercioConMovimientos();
    const movs = (await dueno.cliente.get(`/api/v1/movimientos-stock?productoId=${producto}`)).json<
      { tipo: string; cantidad: number; producto: string }[]
    >();
    expect(movs.map((m) => [m.tipo, m.cantidad])).toEqual([
      ['venta', -2],
      ['compra', 10],
      ['ajuste', 5],
    ]);
    expect(movs[0]?.producto).toBe('Yerba 1 kg');
  });

  it('detalle de un cierre de caja', async () => {
    const { dueno, turnoId } = await comercioConMovimientos();
    const d = (await dueno.cliente.get(`/api/v1/caja/cierres/${turnoId}`)).json<{
      turno: { contado: number; diferencia: number; cambio_inicial: number };
      resumen: { vendido: number; gastos: number; deberiaHaber: number };
      gastos: { motivo: string; monto: number }[];
    }>();
    expect(d.turno).toMatchObject({ contado: 1650000, diferencia: 0, cambio_inicial: 1000000 });
    expect(d.resumen).toMatchObject({ vendido: 800000, gastos: 150000, deberiaHaber: 1650000 });
    expect(d.gastos).toMatchObject([{ motivo: 'Bolsas', monto: 150000 }]);
  });

  it('el cajero no ve el historial', async () => {
    const { dueno, turnoId, compra } = await comercioConMovimientos();
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    for (const url of [
      '/api/v1/movimientos-stock',
      `/api/v1/caja/cierres/${turnoId}`,
      `/api/v1/compras/${compra}`,
    ])
      expect((await cajero.get(url)).statusCode, url).toBe(403);
  });

  it('el cajero no abre ventas de turnos cerrados', async () => {
    const { dueno, turnoId } = await comercioConMovimientos();
    const venta = (await dueno.cliente.get(`/api/v1/ventas?turnoId=${turnoId}`)).json<
      { id: string }[]
    >()[0]!.id;
    expect((await dueno.cliente.get(`/api/v1/ventas/${venta}`)).statusCode).toBe(200);
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    expect((await cajero.get(`/api/v1/ventas/${venta}`)).statusCode).toBe(404);
  });
});
