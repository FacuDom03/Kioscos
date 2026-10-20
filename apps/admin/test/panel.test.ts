import { cerrarBaseApp, crearBaseApp, type BaseApp } from '@mostrador/db';
import {
  codigoTotp,
  crearCifrador,
  hashPassword,
  hashToken,
  nuevoSecretoTotp,
  type Cifrador,
} from '@mostrador/servidor';
import { uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { alertasFacturacion, construirPanel } from '../src/app.ts';

const ORIGEN = 'http://panel.test';
let base: BaseApp;
let admin: pg.Pool;
let panel: FastifyInstance;
let cifrador: Cifrador;
const secreto = nuevoSecretoTotp();
const email = 'yo@mostrador.test';
let cookie = '';

async function pedir(
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT',
  url: string,
  cuerpo?: unknown,
  origen = ORIGEN,
) {
  const r = await panel.inject({
    method: metodo,
    url,
    headers: { origin: origen, ...(cookie ? { cookie } : {}) },
    ...(cuerpo === undefined ? {} : { payload: cuerpo as object }),
  });
  const c = r.cookies.find((x) => x.name === 'mostrador_panel');
  if (c) cookie = `mostrador_panel=${c.value}`;
  return r;
}

beforeAll(async () => {
  base = crearBaseApp(inject('panelUrl'), 2);
  admin = new pg.Pool({ connectionString: inject('adminUrl'), max: 2 });
  cifrador = await crearCifrador({ 1: randomBytes(32).toString('base64') }, 1);
  const { datos, version } = cifrador.cifrar(secreto);
  await admin.query(
    `insert into admins (id, email, password_hash, totp_secreto_cifrado, totp_clave_version) values ($1, $2, $3, $4, $5)`,
    [uuidv7(), email, await hashPassword('contraseña del panel'), datos, version],
  );
  panel = await construirPanel(base, cifrador, {
    origen: ORIGEN,
    origenApp: 'https://app.test',
    cookiesSeguras: false,
  });
});

afterAll(async () => {
  await panel.close();
  await cerrarBaseApp(base);
  await admin.end();
});

describe('panel admin', () => {
  it('sin sesión no muestra nada', async () => {
    expect((await pedir('GET', '/panel/api/kioscos')).statusCode).toBe(401);
  });

  it('pide contraseña y código TOTP', async () => {
    const mal = await pedir('POST', '/panel/api/login', {
      email,
      password: 'contraseña del panel',
      codigo: '000000',
    });
    expect(mal.statusCode).toBe(401);
    const ok = await pedir('POST', '/panel/api/login', {
      email,
      password: 'contraseña del panel',
      codigo: codigoTotp(secreto),
    });
    expect(ok.statusCode).toBe(200);
  });

  it('da de alta un kiosco con su invitación de dueño', async () => {
    const r = await pedir('POST', '/panel/api/kioscos', {
      nombre: 'Kiosco Nuevo',
      plan: 'esencial',
      rubro: 'ferreteria',
      emailDueno: 'dueno@nuevo.test',
    });
    expect(r.statusCode).toBe(200);
    const { id, enlace } = r.json<{ id: string; enlace: string }>();
    const token = enlace.split('#')[1]!;
    const { rows } = await admin.query(
      `select rol, email from invitaciones where token_hash = $1 and kiosco_id = $2`,
      [hashToken(token), id],
    );
    expect(rows).toEqual([{ rol: 'dueno', email: 'dueno@nuevo.test' }]);
    const lista = (await pedir('GET', '/panel/api/kioscos')).json<
      { nombre: string; rubro: string; configurado: boolean }[]
    >();
    // El rubro lo elige quien visita el negocio; el dueño lo confirma al entrar.
    expect(lista.find((k) => k.nombre === 'Kiosco Nuevo')).toMatchObject({
      rubro: 'ferreteria',
      configurado: false,
    });
  });

  it('no da de alta un rubro que no existe', async () => {
    const r = await pedir('POST', '/panel/api/kioscos', {
      nombre: 'Agencia',
      plan: 'esencial',
      rubro: 'agencia',
      emailDueno: 'dueno@agencia.test',
    });
    expect(r.statusCode).toBe(400);
  });

  it('no da de alta un CUIT con el dígito verificador mal', async () => {
    const alta = (cuit: string) =>
      pedir('POST', '/panel/api/kioscos', {
        nombre: `Kiosco ${cuit}`,
        cuit,
        plan: 'esencial',
        rubro: 'kiosco',
        emailDueno: `dueno-${cuit}@cuit.test`,
      });
    expect((await alta('20409378473')).statusCode).toBe(400);
    expect((await alta('20409378472')).statusCode).toBe(200);
  });

  it('cambia plan y estado', async () => {
    const lista = (await pedir('GET', '/panel/api/kioscos')).json<
      { id: string; nombre: string }[]
    >();
    const k = lista.find((x) => x.nombre === 'Kiosco Nuevo')!;
    expect(
      (await pedir('PATCH', `/panel/api/kioscos/${k.id}`, { plan: 'comercio', estado: 'activa' }))
        .statusCode,
    ).toBe(200);
    const { rows } = await admin.query(
      `select plan, estado_suscripcion from kioscos where id = $1`,
      [k.id],
    );
    expect(rows[0]).toEqual({ plan: 'comercio', estado_suscripcion: 'activa' });
  });

  it('no entra como soporte si el dueño no lo activó', async () => {
    const lista = (await pedir('GET', '/panel/api/kioscos')).json<
      { id: string; nombre: string }[]
    >();
    const k = lista.find((x) => x.nombre === 'Kiosco Nuevo')!;
    expect((await pedir('POST', `/panel/api/kioscos/${k.id}/soporte`, {})).statusCode).toBe(409);
    await admin.query(
      `update kioscos set soporte_hasta = now() + interval '1 hour' where id = $1`,
      [k.id],
    );
    const r = await pedir('POST', `/panel/api/kioscos/${k.id}/soporte`, {});
    expect(r.statusCode).toBe(200);
    expect(r.json().enlace).toMatch(/^https:\/\/app\.test\/soporte#/);
  });

  it('facturación: acepta la autorización, suspende, reactiva y cambia el tope', async () => {
    const lista = (await pedir('GET', '/panel/api/kioscos')).json<
      { id: string; nombre: string }[]
    >();
    const k = lista.find((x) => x.nombre === 'Kiosco Nuevo')!;
    await admin.query(
      `insert into config_fiscal (id, kiosco_id, cuit, razon_social, condicion, punto_venta, domicilio, verificada_en)
       values ($1, $2, '20123456786', 'Ana Pérez', 'monotributo', 4, 'Calle 1', now())`,
      [uuidv7(), k.id],
    );
    const fila = async () =>
      (await pedir('GET', '/panel/api/facturacion'))
        .json<{ kiosco_id: string; estado: string; tope_diario: string; alertas: string[] }[]>()
        .find((f) => f.kiosco_id === k.id)!;
    expect(await fila()).toMatchObject({
      estado: 'pendiente',
      alertas: ['Espera que aceptes la autorización en ARCA'],
    });
    const accion = (a: string) =>
      pedir('POST', `/panel/api/facturacion/${k.id}/accion`, { accion: a });
    // "Ya lo acepté": la próxima revisión del worker prueba en el momento.
    expect((await accion('aceptada')).statusCode).toBe(200);
    const { rows: r1 } = await admin.query(
      `select verificada_en from config_fiscal where kiosco_id = $1`,
      [k.id],
    );
    expect(r1[0].verificada_en).toBeNull();

    expect((await accion('suspender')).statusCode).toBe(200);
    expect((await fila()).estado).toBe('suspendida');
    expect((await accion('suspender')).statusCode).toBe(409);
    expect((await accion('reactivar')).statusCode).toBe(200);
    expect((await fila()).estado).toBe('pendiente');
    expect((await accion('borrar')).statusCode).toBe(400);

    expect(
      (await pedir('PUT', `/panel/api/facturacion/${k.id}/tope`, { pesos: 800000 })).statusCode,
    ).toBe(200);
    expect(Number((await fila()).tope_diario)).toBe(80_000_000);
    expect(
      (await pedir('PUT', `/panel/api/facturacion/${k.id}/tope`, { pesos: 10 })).statusCode,
    ).toBe(400);

    const { rows: aud } = await admin.query(
      `select accion from auditoria where kiosco_id = $1 and accion like 'facturacion.panel.%' order by created_at`,
      [k.id],
    );
    expect(aud.map((a) => a.accion)).toEqual([
      'facturacion.panel.aceptada',
      'facturacion.panel.suspender',
      'facturacion.panel.reactivar',
      'facturacion.panel.tope',
    ]);
  });

  it('alertas de facturación en palabras', () => {
    const base = {
      estado: 'activa',
      tope_diario: '100000',
      facturado_hoy: '0',
      facturas_hoy: '0',
      notas_hoy: '0',
      rechazados: '0',
      mayor_repeticion_hoy: '0',
    };
    expect(alertasFacturacion(base)).toEqual([]);
    expect(
      alertasFacturacion({
        ...base,
        facturado_hoy: '95000',
        facturas_hoy: '10',
        notas_hoy: '6',
        mayor_repeticion_hoy: '5',
        rechazados: '1',
      }),
    ).toEqual([
      'En el tope diario o cerca',
      'Muchas anulaciones hoy',
      'El mismo importe alto, muchas veces',
      'Facturas rechazadas por ARCA',
    ]);
  });

  it('rechaza pedidos de otro origen', async () => {
    const r = await pedir(
      'POST',
      '/panel/api/kioscos',
      { nombre: 'X', plan: 'esencial', emailDueno: 'x@x.test' },
      'https://malo.test',
    );
    expect(r.statusCode).toBe(403);
  });

  it('el rol del panel no puede leer tablas directo', async () => {
    const c = new pg.Client({ connectionString: inject('panelUrl') });
    await c.connect();
    await expect(c.query('select * from kioscos')).rejects.toMatchObject({ code: '42501' });
    await expect(c.query('select * from admins')).rejects.toMatchObject({ code: '42501' });
    await c.end();
  });
});
