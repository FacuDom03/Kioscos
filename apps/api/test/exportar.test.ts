import { uuidv7 } from '@mostrador/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { altaConInvitacion, Cliente, crearEntorno, nuevoKiosco, type Entorno } from './ayuda.ts';

let e: Entorno;
beforeAll(async () => {
  e = await crearEntorno();
});
afterAll(async () => {
  await e.cerrar();
});

async function kioscoConVenta() {
  const kioscoId = await nuevoKiosco(e.admin);
  const dueno = await altaConInvitacion(e.app, e.admin, kioscoId);
  const producto = (
    await dueno.cliente.post('/api/v1/productos', {
      nombre: 'Alfajor "triple"',
      precio: 120050,
      stockInicial: 5,
    })
  ).json<{ id: string }>().id;
  await dueno.cliente.post('/api/v1/compras', {
    items: [{ productoId: producto, cantidad: 10, costoUnitario: 70000 }],
    nota: 'Proveedor X',
  });
  const turnoId = uuidv7();
  const total = 240100;
  await dueno.cliente.post('/api/v1/sync', {
    ops: [
      {
        tipo: 'apertura',
        datos: { id: turnoId, cambioInicial: 0, abiertoEn: new Date().toISOString() },
      },
      {
        tipo: 'venta',
        datos: {
          id: uuidv7(),
          turnoId,
          creadaEn: new Date().toISOString(),
          total,
          items: [
            {
              id: uuidv7(),
              productoId: producto,
              descripcion: 'Alfajor "triple"',
              cantidad: 2,
              precioUnitario: 120050,
            },
          ],
          pagos: [{ id: uuidv7(), medio: 'efectivo', monto: total }],
        },
      },
    ],
  });
  return { kioscoId, dueno };
}

const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

describe('exportar', () => {
  it('ventas en CSV para Excel en castellano, con auditoría', async () => {
    const { dueno } = await kioscoConVenta();
    const r = await dueno.cliente.get(`/api/v1/exportar/ventas.csv?desde=${hoy}&hasta=${hoy}`);
    expect(r.headers['content-type']).toContain('text/csv');
    const lineas = r.body.replace('﻿', '').trim().split('\r\n');
    expect(lineas[0]).toBe(
      'Fecha;Total;Medio de pago;Estado;Atendió;Productos;Motivo de anulación;ID',
    );
    expect(lineas[1]).toContain(';2401,00;Efectivo;Cobrada;');
    expect(lineas[1]).toContain('"2 x Alfajor ""triple"""');
    const audit = (await dueno.cliente.get('/api/v1/auditoria')).json<{ accion: string }[]>();
    expect(audit.map((a) => a.accion)).toContain('exportacion.csv');
  });

  it('compras en CSV', async () => {
    const { dueno } = await kioscoConVenta();
    const r = await dueno.cliente.get(`/api/v1/exportar/compras.csv?desde=${hoy}&hasta=${hoy}`);
    expect(r.body).toContain(';10;700,00;7000,00;Proveedor X;');
  });

  it('el encargado no puede exportar', async () => {
    const enc = await altaConInvitacion(e.app, e.admin, await nuevoKiosco(e.admin), 'encargado');
    expect(
      (await enc.cliente.get(`/api/v1/exportar/ventas.csv?desde=${hoy}&hasta=${hoy}`)).statusCode,
    ).toBe(403);
  });

  it('todos los datos en JSON, sin hashes ni tokens', async () => {
    const { dueno } = await kioscoConVenta();
    const r = await dueno.cliente.get('/api/v1/exportar/todo.json');
    const d = r.json();
    expect(d.ventas).toHaveLength(1);
    expect(d.productos[0].nombre).toBe('Alfajor "triple"');
    expect(r.body).not.toMatch(/argon2|password_hash|token|pin_hash/i);
  });
});

describe('borrar la cuenta', () => {
  it('pide el nombre del kiosco y la contraseña, borra todo y cierra la sesión', async () => {
    const { kioscoId, dueno } = await kioscoConVenta();
    const nombre = (await dueno.cliente.get('/api/v1/kiosco')).json<{ nombre: string }>().nombre;
    expect(
      (
        await dueno.cliente.post('/api/v1/kiosco/borrar', {
          nombreKiosco: 'otro',
          password: dueno.password,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await dueno.cliente.post('/api/v1/kiosco/borrar', { nombreKiosco: nombre, password: 'mal' }))
        .statusCode,
    ).toBe(400);
    const r = await dueno.cliente.post('/api/v1/kiosco/borrar', {
      nombreKiosco: nombre,
      password: dueno.password,
    });
    expect(r.statusCode, r.body).toBe(200);
    const { rows } = await e.admin.query(
      `select (select count(*)::int from ventas where kiosco_id = $1) as ventas,
              (select count(*)::int from productos where kiosco_id = $1) as productos,
              (select estado_suscripcion from kioscos where id = $1) as estado,
              (select count(*)::int from usuarios u join membresias m on m.usuario_id = u.id where m.kiosco_id = $1 and u.email is not null) as emails`,
      [kioscoId],
    );
    expect(rows[0]).toEqual({ ventas: 0, productos: 0, estado: 'baja', emails: 0 });
    expect((await dueno.cliente.get('/api/v1/kiosco')).statusCode).toBe(401);
    const otra = new Cliente(e.app);
    expect(
      (await otra.post('/api/v1/auth/login', { email: dueno.email, password: dueno.password }))
        .statusCode,
    ).toBe(401);
  });
});
