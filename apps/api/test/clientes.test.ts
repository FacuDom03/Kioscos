// Clientes y cuenta corriente / fiado (etapa I5).
import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  activarModulos,
  nuevoKiosco,
  type Cliente,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
let dueno: Persona;
let cajero: Cliente;
let kiosco: string;
let turnoId: string;
let queso: string;

function ventaACuenta(clienteId: string | undefined, monto: number, extra = {}) {
  return {
    tipo: 'venta',
    datos: {
      id: uuidv7(),
      turnoId,
      creadaEn: new Date().toISOString(),
      ...(clienteId ? { clienteId } : {}),
      total: monto,
      items: [
        {
          id: uuidv7(),
          productoId: queso,
          descripcion: 'Queso',
          cantidad: 1,
          precioUnitario: monto,
        },
      ],
      pagos: [{ id: uuidv7(), medio: 'cuenta_corriente', monto }],
      ...extra,
    },
  };
}

async function sync(op: unknown) {
  const r = await cajero.post('/api/v1/sync', { ops: [op] });
  expect(r.statusCode, r.body).toBe(200);
  return r.json<{ resultados: { estado: string; mensaje?: string }[] }>().resultados[0];
}

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  await activarModulos(e.admin, kiosco, ['cuenta_corriente']);
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
  queso = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Queso',
      precio: 100,
      stockInicial: 50,
    })
  ).json<{ id: string }>().id;
  ({ cajero } = await cajeroEnEquipo(dueno, e.app));
  turnoId = uuidv7();
  await cajero.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
      },
    ],
  });
});
afterAll(async () => {
  await e.cerrar();
});

describe('cuenta corriente', () => {
  it('el cajero da de alta un cliente, pero sin fiado hasta que el dueño le ponga límite', async () => {
    expect(
      (await cajero.post('/api/v1/clientes', { nombre: 'Rosa', limite: 100000 })).statusCode,
    ).toBe(403);
    const r = await cajero.post('/api/v1/clientes', { nombre: 'Rosa', telefono: '11 5555-0000' });
    expect(r.statusCode, r.body).toBe(200);
    const { id, limite } = r.json<{ id: string; limite: number | null }>();
    expect(limite).toBe(0);
    expect(await sync(ventaACuenta(id, 100))).toMatchObject({ estado: 'rechazada' });
    // El alta queda en la actividad, sin datos personales.
    const { rows } = await e.admin.query<{ detalle: unknown }>(
      `select detalle from auditoria where kiosco_id = $1 and accion = 'cliente.alta'`,
      [kiosco],
    );
    expect(JSON.stringify(rows)).not.toContain('5555');
    expect(rows).toHaveLength(1);
  });

  it('fiar suma a la deuda en la misma transacción que la venta y respeta el límite', async () => {
    const id = (await cajero.post('/api/v1/clientes', { nombre: 'Marta · Calle 9' })).json<{
      id: string;
    }>().id;
    await dueno.cliente.patch(`/api/v1/clientes/${id}`, { limite: 4000000 });

    expect(await sync(ventaACuenta(id, 1820000))).toMatchObject({ estado: 'ok' });
    expect(await sync(ventaACuenta(id, 1073000))).toMatchObject({ estado: 'ok' });
    const pasada = await sync(ventaACuenta(id, 1200000));
    expect(pasada).toMatchObject({ estado: 'rechazada' });
    expect(pasada?.mensaje).toContain('límite de $ 40.000');
    // La venta rechazada no dejó nada.
    const { rows } = await e.admin.query(
      `select count(*)::int as n from ventas where kiosco_id = $1 and cliente_id = $2`,
      [kiosco, id],
    );
    expect(rows[0].n).toBe(2);

    const c = (await cajero.get(`/api/v1/clientes/${id}`)).json();
    expect(c).toMatchObject({ saldo: 2893000, limite: 4000000 });
    expect(c.movimientos).toHaveLength(2);
    const lista = (await cajero.get('/api/v1/clientes?deben=si')).json();
    expect(lista.clientes.find((x: { id: string }) => x.id === id)).toMatchObject({
      saldo: 2893000,
    });
  });

  it('sin cliente o con uno que no existe, la venta a cuenta se rechaza', async () => {
    expect(await sync(ventaACuenta(undefined, 100))).toMatchObject({ estado: 'rechazada' });
    expect(await sync(ventaACuenta(uuidv7(), 100))).toMatchObject({ estado: 'rechazada' });
  });

  it('un pago en efectivo baja la deuda y entra en la caja, sin duplicarse', async () => {
    const id = (await dueno.cliente.post('/api/v1/clientes', { nombre: 'Carlos' })).json<{
      id: string;
    }>().id;
    await sync(ventaACuenta(id, 650000));
    const antes = (await cajero.get('/api/v1/caja')).json().resumen;
    const pago = { id: uuidv7(), monto: 500000, medio: 'efectivo' };
    const r1 = await cajero.post(`/api/v1/clientes/${id}/pagos`, pago);
    expect(r1.json()).toEqual({ saldo: 150000, mensaje: 'Carlos todavía debe $ 1.500.' });
    const r2 = await cajero.post(`/api/v1/clientes/${id}/pagos`, pago);
    expect(r2.json().saldo).toBe(150000);
    const despues = (await cajero.get('/api/v1/caja')).json().resumen;
    expect(despues.cobrosCuenta.efectivo - antes.cobrosCuenta.efectivo).toBe(500000);
    expect(despues.deberiaHaber - antes.deberiaHaber).toBe(500000);
    // Lo fiado se vendió, pero no es plata en la caja.
    expect(despues.porMedio.cuenta_corriente).toBeGreaterThanOrEqual(650000);
  });

  it('anular una venta fiada la descuenta de la deuda', async () => {
    const id = (await dueno.cliente.post('/api/v1/clientes', { nombre: 'Beto' })).json<{
      id: string;
    }>().id;
    const op = ventaACuenta(id, 300000);
    await sync(op);
    const r = await dueno.cliente.post(`/api/v1/ventas/${op.datos.id}/anular`, {
      motivo: 'Se equivocó de cliente',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await cajero.get(`/api/v1/clientes/${id}`)).json().saldo).toBe(0);
  });

  it('el cajero no cobra más de lo que se debe; el pago queda en la actividad', async () => {
    const id = (await dueno.cliente.post('/api/v1/clientes', { nombre: 'Nora' })).json<{
      id: string;
    }>().id;
    await sync(ventaACuenta(id, 2000));
    const demas = await cajero.post(`/api/v1/clientes/${id}/pagos`, {
      id: uuidv7(),
      monto: 5000,
      medio: 'transferencia',
    });
    expect(demas.statusCode).toBe(409);
    expect(demas.json().error).toContain('debe $ 20');
    // Dejar plata a favor lo decide el dueño.
    const r = await dueno.cliente.post(`/api/v1/clientes/${id}/pagos`, {
      id: uuidv7(),
      monto: 5000,
      medio: 'transferencia',
    });
    expect(r.json()).toMatchObject({ saldo: -3000 });
    const { rows } = await e.admin.query(
      `select 1 from auditoria where kiosco_id = $1 and accion = 'cuenta.pago'`,
      [kiosco],
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sin la función activada (o sin el plan Comercio) no se fía, pero se cobra lo que se debe', async () => {
    const id = (await dueno.cliente.post('/api/v1/clientes', { nombre: 'Tito' })).json<{
      id: string;
    }>().id;
    expect(await sync(ventaACuenta(id, 300))).toMatchObject({ estado: 'ok' });
    await e.admin.query(`update kioscos set plan = 'esencial' where id = $1`, [kiosco]);
    expect(await sync(ventaACuenta(id, 100))).toMatchObject({
      estado: 'rechazada',
      mensaje: 'La cuenta corriente no está activada en este comercio.',
    });
    await e.admin.query(`update kioscos set plan = 'comercio', modulos = '{}' where id = $1`, [
      kiosco,
    ]);
    expect((await dueno.cliente.post('/api/v1/clientes', { nombre: 'Lola' })).statusCode).toBe(403);
    const pago = await cajero.post(`/api/v1/clientes/${id}/pagos`, {
      id: uuidv7(),
      monto: 300,
      medio: 'transferencia',
    });
    expect(pago.json()).toMatchObject({ saldo: 0 });
    await activarModulos(e.admin, kiosco, ['cuenta_corriente']);
  });

  it('los datos del cliente salen en la exportación completa', async () => {
    const todo = (await dueno.cliente.get('/api/v1/exportar/todo.json')).json();
    expect(todo.clientes.find((c: { nombre: string }) => c.nombre === 'Rosa')).toMatchObject({
      telefono: '11 5555-0000',
    });
  });
});
