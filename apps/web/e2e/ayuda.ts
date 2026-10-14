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
export async function kioscoConDueno(plan: 'esencial' | 'comercio' = 'comercio'): Promise<Dueno> {
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
  await c.query(`insert into kioscos (id, nombre, plan) values ($1, $2, $3)`, [
    kioscoId,
    kiosco,
    plan,
  ]);
  await c.query(`insert into cajas (id, kiosco_id) values ($1, $2)`, [uuidv7(), kioscoId]);
  await c.query(
    `insert into usuarios (id, email, nombre, password_hash, totp_secreto_cifrado, totp_clave_version, segundo_factor_activo)
     values ($1, $2, 'Anita', $3, $4, 1, true)`,
    [usuario, email, await hashPassword(password), totp.datos],
  );
  await c.query(
    `insert into membresias (id, kiosco_id, usuario_id, rol) values ($1, $2, $3, 'dueno')`,
    [uuidv7(), kioscoId, usuario],
  );
  return { kioscoId, kiosco, email, password, secreto };
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
