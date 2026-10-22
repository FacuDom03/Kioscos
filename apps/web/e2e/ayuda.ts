// Ayudas de las pruebas de punta a punta: kiosco nuevo con su dueño y entrada con sesión.
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { crearCifrador } from '../../../packages/servidor/src/cifrado.ts';
import { hashPassword } from '../../../packages/servidor/src/password.ts';
import { codigoTotp } from '../../../packages/servidor/src/totp.ts';
import { uuidv7 } from '../../../packages/shared/src/uuid.ts';

export { codigoTotp };

interface Datos {
  mpUrl: string;
  adminUrl: string;
  claves: Record<number, string>;
  origen: string;
}
const datos = (): Datos =>
  JSON.parse(readFileSync(new URL('./.datos.json', import.meta.url), 'utf8')) as Datos;

let pool: pg.Pool | undefined;
export const admin = () => (pool ??= new pg.Pool({ connectionString: datos().adminUrl, max: 2 }));

export interface Dueno {
  kioscoId: string;
  kiosco: string;
  email: string;
  password: string;
  secreto: Buffer;
}

/** Kiosco nuevo con su caja y un dueño con contraseña y TOTP ya configurados. */
export async function kioscoConDueno(
  plan: 'esencial' | 'comercio' = 'comercio',
  opciones: { cajaAbierta?: boolean; rubro?: string; configurado?: boolean } = {
    cajaAbierta: true,
  },
): Promise<Dueno> {
  const d = datos();
  const cifrador = await crearCifrador(d.claves, 1);
  const kioscoId = uuidv7();
  const usuario = uuidv7();
  const kiosco = `Kiosco ${kioscoId.slice(-5)}`;
  const email = `dueno-${kioscoId}@e2e.test`;
  const password = 'contraseña de prueba';
  const secreto = randomSecreto();
  const totp = cifrador.cifrar(secreto);
  const c = admin();
  await c.query(
    `insert into kioscos (id, nombre, plan, rubro, configurado) values ($1, $2, $3, $4, $5)`,
    [kioscoId, kiosco, plan, opciones.rubro ?? 'kiosco', opciones.configurado ?? true],
  );
  const caja = uuidv7();
  await c.query(`insert into cajas (id, kiosco_id) values ($1, $2)`, [caja, kioscoId]);
  await c.query(
    `insert into usuarios (id, email, nombre, password_hash, totp_secreto_cifrado, totp_clave_version, segundo_factor_activo)
     values ($1, $2, 'Anita', $3, $4, 1, true)`,
    [usuario, email, await hashPassword(password), totp.datos],
  );
  await c.query(
    `insert into membresias (id, kiosco_id, usuario_id, rol) values ($1, $2, $3, 'dueno')`,
    [uuidv7(), kioscoId, usuario],
  );
  if (opciones.cajaAbierta) {
    await c.query(
      `insert into turnos_caja (id, kiosco_id, caja_id, abierto_por, cambio_inicial) values ($1, $2, $3, $4, 1000000)`,
      [uuidv7(), kioscoId, caja, usuario],
    );
  }
  return { kioscoId, kiosco, email, password, secreto };
}

/** Productos de prueba (precio en centavos). */
export async function productos(
  kioscoId: string,
  lista: {
    nombre: string;
    precio: number;
    codigo?: string;
    stock?: number;
    unidad?: string;
    ubicacion?: string;
    precioGremio?: number;
  }[],
) {
  const c = admin();
  for (const p of lista) {
    const id = uuidv7();
    await c.query(
      `insert into productos (id, kiosco_id, nombre, precio, stock_actual, unidad, ubicacion, precio_gremio)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        kioscoId,
        p.nombre,
        p.precio,
        p.stock ?? 20,
        p.unidad ?? 'unidad',
        p.ubicacion ?? null,
        p.precioGremio ?? null,
      ],
    );
    if (p.codigo)
      await c.query(
        `insert into codigos_barra (id, kiosco_id, producto_id, codigo, tipo) values ($1, $2, $3, $4, $5)`,
        [uuidv7(), kioscoId, id, p.codigo, /^\d{13}$/.test(p.codigo) ? 'ean13' : 'interno'],
      );
  }
}

/** Activa funciones del rubro en el comercio (como lo haría el dueño desde Más). */
export async function activarModulos(kioscoId: string, modulos: string[]) {
  await admin().query('update kioscos set modulos = $2 where id = $1', [kioscoId, modulos]);
}

function randomSecreto(): Buffer {
  return Buffer.from(Array.from({ length: 20 }, () => Math.floor(Math.random() * 256)));
}

/** Entra como el dueño por la API (las cookies quedan en el contexto del navegador). */
export async function entrar(page: Page, d: Dueno): Promise<void> {
  const origin = datos().origen;
  const r1 = await page.request.post('/api/v1/auth/login', {
    data: { email: d.email, password: d.password },
    headers: { origin },
  });
  if (!r1.ok()) throw new Error(`login: ${r1.status()} ${await r1.text()}`);
  const r2 = await page.request.post('/api/v1/auth/totp', {
    data: { codigo: codigoTotp(d.secreto) },
    headers: { origin },
  });
  if (!r2.ok()) throw new Error(`totp: ${r2.status()} ${await r2.text()}`);
}

export async function invitacion(
  kioscoId: string,
  email: string,
  rol: 'dueno' | 'encargado',
): Promise<string> {
  const { tokenAleatorio, hashToken } = await import('../../../packages/servidor/src/tokens.ts');
  const token = tokenAleatorio();
  await admin().query(
    `insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en) values ($1, $2, $3, $4, $5, now() + interval '1 day')`,
    [uuidv7(), kioscoId, email, rol, hashToken(token)],
  );
  return token;
}

/** Simula que el cliente pagó con el QR (Mercado Pago falso de las pruebas). */
export async function pagarQr(kioscoId: string): Promise<void> {
  const caja = `MOSTRADOR${kioscoId.replace(/-/g, '').toUpperCase()}`.slice(0, 40);
  const r = await fetch(`${datos().mpUrl}/__pruebas/pagar?caja=${caja}`, { method: 'POST' });
  if (!r.ok) throw new Error('no hay orden para pagar');
}

/**
 * Va a una sección como lo haría la persona: por la barra si está ahí, o desde Más (en celular y
 * tablet, Compras y Tablero se abren desde Más).
 */
export async function irA(page: Page, seccion: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Secciones' });
  const boton = nav.getByRole('button', { name: seccion, exact: true });
  if (await boton.isVisible()) {
    await boton.click();
    return;
  }
  await nav.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${seccion}\\b`) }).click();
}
