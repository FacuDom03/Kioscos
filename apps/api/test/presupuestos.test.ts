// Presupuestos: se guardan desde el ticket, se numeran, vencen y pasan a venta (etapa I4).
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
let dueno: Persona;
let cajero: Cliente;
let kiosco: string;
let cable: string;

const enDias = (n: number) =>
  new Date(Date.now() + n * 24 * 3600_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });

function presupuesto(extra: Record<string, unknown> = {}) {
  return {
    id: uuidv7(),
    lista: 'gremio',
    para: 'Obra de calle 9',
    venceEn: enDias(15),
    total: 1537500 + 390000,
    items: [
      {
        productoId: cable,
        descripcion: 'Cable unipolar 2,5 mm² rojo',
        cantidad: 12.5,
        unidad: 'metro',
        precioUnitario: 123000,
      },
      { productoId: null, descripcion: 'Flete', cantidad: 1, precioUnitario: 390000 },
    ],
    ...extra,
  };
}

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
  cable = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Cable unipolar 2,5 mm² rojo',
      precio: 145000,
      precioGremio: 123000,
      unidad: 'metro',
      stockInicial: 100,
    })
  ).json<{ id: string }>().id;
  ({ cajero } = await cajeroEnEquipo(dueno, e.app));
});
afterAll(async () => {
  await e.cerrar();
});

describe('presupuestos', () => {
  it('se guardan con número correlativo, sin duplicarse al reintentar', async () => {
    const p = presupuesto();
    const r1 = await cajero.post('/api/v1/presupuestos', p);
    expect(r1.statusCode, r1.body).toBe(200);
    const r2 = await cajero.post('/api/v1/presupuestos', p);
    expect(r2.json()).toEqual(r1.json());
    const otro = await cajero.post('/api/v1/presupuestos', presupuesto());
    expect(otro.json<{ numero: number }>().numero).toBe(r1.json<{ numero: number }>().numero + 1);

    const d = (await cajero.get(`/api/v1/presupuestos/${p.id}`)).json();
    expect(d).toMatchObject({
      numero: 1,
      lista: 'gremio',
      para: 'Obra de calle 9',
      estado: 'abierto',
      total: 1927500,
      venceEn: p.venceEn,
    });
    expect(d.items).toEqual([
      expect.objectContaining({ cantidad: 12.5, unidad: 'metro', subtotal: 1537500 }),
      expect.objectContaining({ descripcion: 'Flete', unidad: 'unidad', subtotal: 390000 }),
    ]);
  });

  it('rechaza totales que no cierran y fechas pasadas', async () => {
    expect((await cajero.post('/api/v1/presupuestos', presupuesto({ total: 1 }))).statusCode).toBe(
      400,
    );
    expect(
      (await cajero.post('/api/v1/presupuestos', presupuesto({ venceEn: enDias(-1) }))).statusCode,
    ).toBe(400);
  });

  it('el que vence queda vencido y se puede anular', async () => {
    const p = presupuesto();
    await cajero.post('/api/v1/presupuestos', p);
    await e.admin.query(`update presupuestos set vence_en = current_date - 1 where id = $1`, [
      p.id,
    ]);
    const lista = (await cajero.get('/api/v1/presupuestos')).json<
      { id: string; estado: string }[]
    >();
    expect(lista.find((x) => x.id === p.id)?.estado).toBe('vencido');
    expect((await cajero.post(`/api/v1/presupuestos/${p.id}/anular`, {})).statusCode).toBe(200);
    expect((await cajero.post(`/api/v1/presupuestos/${p.id}/anular`, {})).statusCode).toBe(409);
    const abiertos = (await cajero.get('/api/v1/presupuestos')).json<{ id: string }[]>();
    expect(abiertos.some((x) => x.id === p.id)).toBe(false);
  });

  it('al venderse queda vendido y ligado a la venta, en la misma transacción', async () => {
    const p = presupuesto();
    await cajero.post('/api/v1/presupuestos', p);
    const turnoId = uuidv7();
    const ventaId = uuidv7();
    const r = await cajero.post('/api/v1/sync', {
      ops: [
        {
          tipo: 'apertura',
          datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
        },
        {
          tipo: 'venta',
          datos: {
            id: ventaId,
            turnoId,
            creadaEn: new Date().toISOString(),
            lista: 'gremio',
            presupuestoId: p.id,
            total: p.total,
            items: p.items.map((i) => ({
              id: uuidv7(),
              productoId: i.productoId,
              descripcion: i.descripcion,
              cantidad: i.cantidad,
              precioUnitario: i.precioUnitario,
            })),
            pagos: [{ id: uuidv7(), medio: 'transferencia', monto: p.total }],
          },
        },
      ],
    });
    expect(r.json().resultados[1], r.body).toMatchObject({ estado: 'ok' });
    expect((await cajero.get(`/api/v1/presupuestos/${p.id}`)).json()).toMatchObject({
      estado: 'vendido',
      ventaId,
    });
  });

  it('cuando una venta con QR se cobra, el presupuesto queda vendido', async () => {
    const p = presupuesto();
    await cajero.post('/api/v1/presupuestos', p);
    // Simula la venta abierta del QR ligada al presupuesto y su cobro.
    const turno = await e.admin.query<{ id: string }>(
      `select id from turnos_caja where kiosco_id = $1 and cerrado_en is null`,
      [kiosco],
    );
    const ventaId = uuidv7();
    const { rows } = await e.admin.query<{ usuario_id: string }>(
      `select usuario_id from membresias where kiosco_id = $1 and rol = 'dueno'`,
      [kiosco],
    );
    await e.admin.query(
      `insert into ventas (id, kiosco_id, turno_id, usuario_id, total, estado, creada_en_dispositivo)
       values ($1, $2, $3, $4, $5, 'abierta', now())`,
      [ventaId, kiosco, turno.rows[0]?.id, rows[0]?.usuario_id, p.total],
    );
    await e.admin.query(`update presupuestos set venta_id = $1 where id = $2`, [ventaId, p.id]);
    await e.admin.query(`update ventas set estado = 'cobrada' where id = $1`, [ventaId]);
    expect((await cajero.get(`/api/v1/presupuestos/${p.id}`)).json()).toMatchObject({
      estado: 'vendido',
    });
  });
});
