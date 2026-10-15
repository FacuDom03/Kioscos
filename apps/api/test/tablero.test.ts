// Tablero (etapa I6): qué se vende, qué no se mueve, qué falta y cuánto se gana.
import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
let dueno: Persona;
let kiosco: string;
const ids: Record<string, string> = {};

async function producto(datos: Record<string, unknown>) {
  const r = await dueno.cliente.post('/api/v1/productos', datos);
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ id: string }>().id;
}

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
  const elec = (await dueno.cliente.post('/api/v1/categorias', { nombre: 'Electricidad' })).json<{
    id: string;
  }>().id;
  const plom = (await dueno.cliente.post('/api/v1/categorias', { nombre: 'Plomería' })).json<{
    id: string;
  }>().id;
  ids.cable = await producto({
    nombre: 'Cable 2,5',
    precio: 145000,
    costo: 98000,
    unidad: 'metro',
    categoriaId: elec,
    stockInicial: 184,
  });
  ids.cano = await producto({
    nombre: 'Caño 20 mm',
    precio: 390000,
    costo: 270000,
    categoriaId: plom,
    stockInicial: 50,
  });
  ids.amoladora = await producto({
    nombre: 'Amoladora 115 mm',
    precio: 12000000,
    costo: 8500000,
    stockInicial: 3,
  });
  ids.tarugo = await producto({
    nombre: 'Tarugo 8 mm',
    precio: 520000,
    minimo: 10,
    stockInicial: 3,
  });

  const turnoId = uuidv7();
  const venta = (items: { productoId: string; cantidad: number; precio: number }[]) => {
    const total = items.reduce((t, i) => t + Math.round(i.cantidad * i.precio), 0);
    return {
      tipo: 'venta',
      datos: {
        id: uuidv7(),
        turnoId,
        creadaEn: new Date().toISOString(),
        total,
        items: items.map((i) => ({
          id: uuidv7(),
          productoId: i.productoId,
          descripcion: 'x',
          cantidad: i.cantidad,
          precioUnitario: i.precio,
        })),
        pagos: [{ id: uuidv7(), medio: 'efectivo', monto: total }],
      },
    };
  };
  const r = await dueno.cliente.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
      },
      venta([{ productoId: ids.cable, cantidad: 12.5, precio: 145000 }]),
      venta([{ productoId: ids.cano, cantidad: 2, precio: 390000 }]),
    ],
  });
  expect(r.json().resultados.map((x: { estado: string }) => x.estado)).toEqual(['ok', 'ok', 'ok']);
});
afterAll(async () => {
  await e.cerrar();
});

describe('tablero', () => {
  it('cuenta lo vendido, lo que más se vende, la ganancia, lo quieto y lo que falta', async () => {
    const r = await dueno.cliente.get('/api/v1/tablero?periodo=30');
    expect(r.statusCode, r.body).toBe(200);
    const t = r.json();
    expect(t.resumen).toMatchObject({ vendido: 2592500, ventas: 2, ticketPromedio: 1296250 });
    expect(t.masVendidos.map((m: { nombre: string }) => m.nombre)).toEqual([
      'Cable 2,5',
      'Caño 20 mm',
    ]);
    expect(t.masVendidos[0]).toMatchObject({ cantidad: 12.5, unidad: 'metro', importe: 1812500 });
    // 1.812.500 vendido contra 12,5 × 98.000 = 1.225.000 de costo: 48 % sobre el costo.
    expect(t.categorias).toEqual([
      { categoria: 'Electricidad', importe: 1812500, ganancia: 48 },
      { categoria: 'Plomería', importe: 780000, ganancia: 44.4 },
    ]);
    expect(t.sinMovimiento.lista.map((x: { nombre: string }) => x.nombre)).toEqual([
      'Amoladora 115 mm',
      'Tarugo 8 mm',
    ]);
    expect(t.sinMovimiento.plataParada).toBe(25500000);
    expect(t.porReponer).toMatchObject({
      productos: 1,
      lista: [{ nombre: 'Tarugo 8 mm', stock: 3, minimo: 10 }],
    });
    expect(t.preciosViejos).toBe(0);
  });

  it('el cajero no ve el tablero', async () => {
    const { cajeroEnEquipo } = await import('./ayuda.ts');
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    expect((await cajero.get('/api/v1/tablero')).statusCode).toBe(403);
  });

  it('con 10.000 ventas carga en menos de 2 segundos', async () => {
    await e.admin.query(
      `with t as (select id from turnos_caja where kiosco_id = $1 limit 1),
            u as (select usuario_id from membresias where kiosco_id = $1 and rol = 'dueno' limit 1),
            v as (
              insert into ventas (id, kiosco_id, turno_id, usuario_id, total, estado, creada_en_dispositivo)
              select gen_random_uuid(), $1, (select id from t), (select usuario_id from u), 390000, 'cobrada',
                     now() - (g % 80) * interval '1 day'
              from generate_series(1, 10000) g
              returning id
            )
       insert into venta_items (id, kiosco_id, venta_id, producto_id, descripcion, cantidad, precio_unitario, subtotal)
       select gen_random_uuid(), $1, v.id, $2, 'Caño', 1, 390000, 390000 from v`,
      [kiosco, ids.cano],
    );
    const t0 = performance.now();
    const r = await dueno.cliente.get('/api/v1/tablero?periodo=90');
    const ms = performance.now() - t0;
    expect(r.statusCode).toBe(200);
    expect(r.json().resumen.ventas).toBeGreaterThanOrEqual(10000);
    expect(ms).toBeLessThan(2000);
  });
});
