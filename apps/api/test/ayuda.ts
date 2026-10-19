// Ayudas para las pruebas de la API: app de prueba, cliente con cookies y altas de personas.
import { cerrarBaseApp, crearBaseApp, type BaseApp } from '@mostrador/db';
import { KIOSCO_A, KIOSCO_B } from '@mostrador/db/semillas';
import { uuidv7 } from '@mostrador/shared';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { construirApp, type OpcionesApp } from '../src/app.ts';
import type { Config } from '../src/config.ts';
import { codigoTotp } from '@mostrador/servidor';
import { hashToken, tokenAleatorio } from '@mostrador/servidor';

export { KIOSCO_A, KIOSCO_B };

export const ORIGEN = 'https://app.mostrador.test';

export const configPrueba: Config = {
  origen: ORIGEN,
  rpId: 'app.mostrador.test',
  rpNombre: 'Mostrador',
  cookiesSeguras: true,
  claves: { 1: randomBytes(32).toString('base64') },
  claveActual: 1,
};

export interface Entorno {
  app: FastifyInstance;
  base: BaseApp;
  admin: pg.Pool;
  cerrar(): Promise<void>;
}

export const SECRETO_WEBHOOK = 'clave-secreta-de-webhooks';

export async function crearEntorno(
  opciones: {
    mpUrl?: string;
    encolarOrdenMp?: (id: string) => Promise<void>;
    encolarAviso?: OpcionesApp['encolarAviso'];
    opcionesEnvio?: OpcionesApp['opcionesEnvio'];
    facturacion?: OpcionesApp['facturacion'];
    encolarFactura?: OpcionesApp['encolarFactura'];
  } = {},
): Promise<Entorno> {
  const base = crearBaseApp(inject('appUrl'), 4);
  const app = await construirApp({
    base,
    config: configPrueba,
    limitarPedidos: false,
    ...(opciones.encolarOrdenMp ? { encolarOrdenMp: opciones.encolarOrdenMp } : {}),
    ...(opciones.encolarAviso ? { encolarAviso: opciones.encolarAviso } : {}),
    ...(opciones.opcionesEnvio ? { opcionesEnvio: opciones.opcionesEnvio } : {}),
    ...(opciones.facturacion ? { facturacion: opciones.facturacion } : {}),
    ...(opciones.encolarFactura ? { encolarFactura: opciones.encolarFactura } : {}),
    mp: opciones.mpUrl
      ? {
          clientId: 'app-id',
          clientSecret: 'secreto-app',
          redirectUri: `${ORIGEN}/api/v1/mp/callback`,
          webhookSecret: SECRETO_WEBHOOK,
          apiBase: opciones.mpUrl,
          authUrl: 'https://auth.mercadopago.test/authorization',
          pruebas: true,
        }
      : null,
  });
  await app.ready();
  const admin = new pg.Pool({ connectionString: inject('adminUrl'), max: 2 });
  return {
    app,
    base,
    admin,
    async cerrar() {
      await app.close();
      await cerrarBaseApp(base);
      await admin.end();
    },
  };
}

/** Cliente que guarda cookies entre pedidos y manda el Origin correcto. */
export class Cliente {
  cookies = new Map<string, string>();
  origen: string | null = ORIGEN;
  /** Clave de API (`mst_…`) para las rutas de la API de los comercios. */
  clave: string | null = null;
  private readonly app: FastifyInstance;
  constructor(app: FastifyInstance) {
    this.app = app;
  }

  async pedir(
    metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    cuerpo?: unknown,
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = {};
    if (this.origen) headers['origin'] = this.origen;
    if (this.clave) headers['authorization'] = `Bearer ${this.clave}`;
    if (this.cookies.size)
      headers['cookie'] = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const opciones: InjectOptions = { method: metodo, url, headers };
    if (cuerpo !== undefined) opciones.payload = cuerpo as Record<string, unknown>;
    const r: LightMyRequestResponse = await this.app.inject(opciones);
    for (const c of r.cookies) {
      if (
        c.value === '' ||
        (c.maxAge !== undefined && c.maxAge <= 0) ||
        (c.expires && c.expires < new Date())
      ) {
        this.cookies.delete(c.name);
      } else {
        this.cookies.set(c.name, c.value);
      }
    }
    return r;
  }
  get = (url: string) => this.pedir('GET', url);
  post = (url: string, cuerpo: unknown = {}) => this.pedir('POST', url, cuerpo);
  put = (url: string, cuerpo: unknown = {}) => this.pedir('PUT', url, cuerpo);
  patch = (url: string, cuerpo: unknown = {}) => this.pedir('PATCH', url, cuerpo);
  delete = (url: string) => this.pedir('DELETE', url);
}

export interface Persona {
  cliente: Cliente;
  email: string;
  password: string;
  secretoTotp: Buffer;
  codigos: string[];
}

function decodificarBase32(texto: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let valor = 0;
  const salida: number[] = [];
  for (const ch of texto) {
    valor = (valor << 5) | alfabeto.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(salida);
}

/** Crea una invitación directo en la base (como haría el panel) y devuelve el token. */
export async function invitar(
  admin: pg.Pool,
  kiosco: string,
  email: string,
  rol: 'dueno' | 'encargado',
) {
  const token = tokenAleatorio();
  await admin.query(
    `insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en)
     values ($1, $2, $3, $4, $5, now() + interval '72 hours')`,
    [uuidv7(), kiosco, email, rol, hashToken(token)],
  );
  return token;
}

/** Acepta una invitación y configura TOTP: termina con una sesión completa. */
export async function altaConInvitacion(
  app: FastifyInstance,
  admin: pg.Pool,
  kiosco: string,
  rol: 'dueno' | 'encargado' = 'dueno',
): Promise<Persona> {
  const email = `persona-${uuidv7()}@ejemplo.test`;
  const password = 'una contraseña larga';
  const token = await invitar(admin, kiosco, email, rol);
  const cliente = new Cliente(app);
  const r1 = await cliente.post(`/api/v1/auth/invitaciones/${token}`, {
    nombre: 'Persona',
    password,
  });
  if (r1.statusCode !== 200) throw new Error(`invitación: ${r1.statusCode} ${r1.body}`);
  const r2 = await cliente.post('/api/v1/auth/configurar/totp');
  const secretoTotp = decodificarBase32(r2.json<{ secreto: string }>().secreto);
  const r3 = await cliente.post('/api/v1/auth/configurar/totp/confirmar', {
    codigo: codigoTotp(secretoTotp),
  });
  if (r3.statusCode !== 200) throw new Error(`totp: ${r3.statusCode} ${r3.body}`);
  return {
    cliente,
    email,
    password,
    secretoTotp,
    codigos: r3.json<{ codigosRecuperacion: string[] }>().codigosRecuperacion,
  };
}

/** Dueño con equipo autorizado y un cajero con PIN; devuelve el cliente del cajero ya logueado. */
export async function cajeroEnEquipo(dueno: Persona, app: FastifyInstance, pin = '1234') {
  const equipo = await dueno.cliente.post('/api/v1/dispositivos', { nombre: 'PC mostrador' });
  if (equipo.statusCode !== 200) throw new Error(equipo.body);
  const alta = await dueno.cliente.post('/api/v1/usuarios/cajeros', {
    nombre: `Cajero ${uuidv7().slice(-4)}`,
    pin,
  });
  if (alta.statusCode !== 200) throw new Error(alta.body);
  const membresiaId = alta.json<{ id: string }>().id;
  const cajero = new Cliente(app);
  const cookieEquipo = dueno.cliente.cookies.get('__Host-mostrador-equipo');
  if (!cookieEquipo) throw new Error('sin cookie de equipo');
  cajero.cookies.set('__Host-mostrador-equipo', cookieEquipo);
  const r = await cajero.post('/api/v1/auth/pin', { membresiaId, pin });
  if (r.statusCode !== 200) throw new Error(r.body);
  return { cajero, membresiaId, cookieEquipo };
}

/** Kiosco nuevo y vacío (con su caja), como lo crea el panel. */
export async function nuevoKiosco(
  admin: pg.Pool,
  plan: 'esencial' | 'comercio' = 'comercio',
): Promise<string> {
  const id = uuidv7();
  await admin.query(`insert into kioscos (id, nombre, plan) values ($1, $2, $3)`, [
    id,
    `Kiosco ${id.slice(-6)}`,
    plan,
  ]);
  await admin.query(`insert into cajas (id, kiosco_id) values ($1, $2)`, [uuidv7(), id]);
  return id;
}

/** Activa funciones del rubro (como lo hace el dueño en Más → Tu negocio). */
export async function activarModulos(admin: pg.Pool, kioscoId: string, modulos: string[]) {
  await admin.query('update kioscos set modulos = $2 where id = $1', [kioscoId, modulos]);
}
