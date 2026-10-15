// Rubro, funciones y categorías del comercio (docs/decisiones/009-rubros.md).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  altaConInvitacion,
  cajeroEnEquipo,
  crearEntorno,
  nuevoKiosco,
  type Entorno,
  type Persona,
} from './ayuda.ts';

let e: Entorno;
let dueno: Persona;
let kiosco: string;

beforeAll(async () => {
  e = await crearEntorno();
  kiosco = await nuevoKiosco(e.admin);
  // Como lo deja el panel: rubro elegido por quien visitó el negocio y sin configurar.
  await e.admin.query(
    `update kioscos set rubro = 'ferreteria', configurado = false where id = $1`,
    [kiosco],
  );
  dueno = await altaConInvitacion(e.app, e.admin, kiosco);
});
afterAll(async () => {
  await e.cerrar();
});

describe('negocio', () => {
  it('la sesión trae el rubro y avisa que falta armar el negocio', async () => {
    const yo = (await dueno.cliente.get('/api/v1/auth/yo')).json();
    expect(yo.kiosco).toMatchObject({ rubro: 'ferreteria', modulos: [], configurado: false });
  });

  it('el dueño confirma el rubro, elige funciones y agrega categorías sin repetir', async () => {
    await dueno.cliente.post('/api/v1/categorias', { nombre: 'Plomería' });
    const r = await dueno.cliente.put('/api/v1/kiosco/negocio', {
      rubro: 'ferreteria',
      modulos: ['presupuestos', 'venta_fraccionada', 'presupuestos'],
      categorias: ['Electricidad', 'plomería', 'Pinturería'],
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      rubro: 'ferreteria',
      modulos: ['presupuestos', 'venta_fraccionada'],
      configurado: true,
      categoriasNuevas: 2,
    });
    const k = (await dueno.cliente.get('/api/v1/kiosco')).json();
    expect(k).toMatchObject({ rubro: 'ferreteria', configurado: true });
    const { rows } = await e.admin.query<{ nombre: string }>(
      'select nombre from categorias where kiosco_id = $1 order by orden',
      [kiosco],
    );
    expect(rows.map((c) => c.nombre)).toEqual(['Plomería', 'Electricidad', 'Pinturería']);
    const audit = await e.admin.query<{ detalle: unknown }>(
      `select detalle from auditoria where kiosco_id = $1 and accion = 'kiosco.negocio'`,
      [kiosco],
    );
    expect(audit.rows[0]?.detalle).toMatchObject({ rubro: 'ferreteria', categoriasNuevas: 2 });
  });

  it('rechaza rubros y funciones que no existen y campos de más', async () => {
    for (const cuerpo of [
      { rubro: 'agencia', modulos: [], categorias: [] },
      { rubro: 'kiosco', modulos: ['magia'], categorias: [] },
      { rubro: 'kiosco', modulos: [], categorias: [], extra: true },
      { rubro: 'kiosco', modulos: [], categorias: ['x'.repeat(61)] },
    ]) {
      const r = await dueno.cliente.put('/api/v1/kiosco/negocio', cuerpo);
      expect(r.statusCode, JSON.stringify(cuerpo)).toBe(400);
    }
  });

  it('con el plan Esencial no se activan el fiado ni las listas de proveedores', async () => {
    await e.admin.query(`update kioscos set plan = 'esencial' where id = $1`, [kiosco]);
    const r = await dueno.cliente.put('/api/v1/kiosco/negocio', {
      rubro: 'almacen',
      modulos: ['cuenta_corriente', 'venta_fraccionada'],
      categorias: [],
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toContain('plan Comercio');
    const ok = await dueno.cliente.put('/api/v1/kiosco/negocio', {
      rubro: 'almacen',
      modulos: ['venta_fraccionada'],
      categorias: [],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    await e.admin.query(`update kioscos set plan = 'comercio' where id = $1`, [kiosco]);
  });

  it('solo el dueño puede cambiar el rubro', async () => {
    const { cajero } = await cajeroEnEquipo(dueno, e.app);
    const r = await cajero.put('/api/v1/kiosco/negocio', {
      rubro: 'kiosco',
      modulos: [],
      categorias: [],
    });
    expect(r.statusCode).toBe(403);
    const encargado = await altaConInvitacion(e.app, e.admin, kiosco, 'encargado');
    const r2 = await encargado.cliente.put('/api/v1/kiosco/negocio', {
      rubro: 'kiosco',
      modulos: [],
      categorias: [],
    });
    expect(r2.statusCode).toBe(403);
  });
});
