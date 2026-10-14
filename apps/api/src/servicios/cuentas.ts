// Acceso a las funciones de sistema de cuentas (auth_*). Ver migración 0004.
import { sinKiosco, type BaseApp, type Rol } from '@mostrador/db';
import { sql } from '@mostrador/db';

export interface Credenciales {
  usuario_id: string;
  password_hash: string | null;
  segundo_factor_activo: boolean;
  totp_secreto_cifrado: Buffer | null;
  totp_clave_version: number | null;
  bloqueado_hasta: Date | null;
  tiene_passkey: boolean;
}

export async function credencialesPorEmail(
  base: BaseApp,
  email: string,
): Promise<Credenciales | null> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<Credenciales>`select * from auth_credenciales(${email})`.execute(tx),
  );
  return rows[0] ?? null;
}

export async function registrarIntento(base: BaseApp, usuarioId: string, ok: boolean) {
  await sinKiosco(base, (tx) =>
    sql`select auth_registrar_intento(${usuarioId}, ${ok})`.execute(tx),
  );
}

export interface EstadoTotp {
  totp_secreto_cifrado: Buffer | null;
  totp_clave_version: number | null;
  segundo_factor_activo: boolean;
}

export async function leerTotp(base: BaseApp, usuarioId: string): Promise<EstadoTotp | null> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<EstadoTotp>`select * from auth_leer_totp(${usuarioId})`.execute(tx),
  );
  return rows[0] ?? null;
}

export async function guardarTotp(
  base: BaseApp,
  usuarioId: string,
  secreto: Buffer,
  version: number,
) {
  await sinKiosco(base, (tx) =>
    sql`select auth_guardar_totp(${usuarioId}, ${secreto}, ${version}::smallint)`.execute(tx),
  );
}

export async function activarSegundoFactor(
  base: BaseApp,
  usuarioId: string,
  hashesCodigos: string[],
) {
  await sinKiosco(base, (tx) =>
    sql`select auth_activar_segundo_factor(${usuarioId}, ${hashesCodigos}::text[])`.execute(tx),
  );
}

export async function usarCodigoRecuperacion(
  base: BaseApp,
  usuarioId: string,
  hash: string,
): Promise<boolean> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{ ok: boolean }>`select auth_usar_codigo_recuperacion(${usuarioId}, ${hash}) as ok`.execute(
      tx,
    ),
  );
  return rows[0]?.ok === true;
}

export interface Invitacion {
  kiosco_id: string;
  kiosco_nombre: string;
  email: string;
  rol: Rol;
  usuario_existe: boolean;
}

export async function buscarInvitacion(
  base: BaseApp,
  tokenHash: string,
): Promise<Invitacion | null> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<Invitacion>`select * from auth_buscar_invitacion(${tokenHash})`.execute(tx),
  );
  return rows[0] ?? null;
}

export async function aceptarInvitacion(
  base: BaseApp,
  datos: {
    tokenHash: string;
    usuarioNuevo: string;
    membresia: string;
    nombre: string;
    passwordHash: string | null;
  },
): Promise<string> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{ id: string }>`select auth_aceptar_invitacion(${datos.tokenHash}, ${datos.usuarioNuevo},
      ${datos.membresia}, ${datos.nombre}, ${datos.passwordHash}) as id`.execute(tx),
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('No se pudo aceptar la invitación');
  return id;
}

export interface Dispositivo {
  dispositivo_id: string;
  kiosco_id: string;
  nombre: string;
}

export async function dispositivoPorCredencial(
  base: BaseApp,
  credencialHash: string,
): Promise<Dispositivo | null> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<Dispositivo>`select * from auth_dispositivo(${credencialHash})`.execute(tx),
  );
  return rows[0] ?? null;
}

export interface PasskeyGuardada {
  credential_id: string;
  clave_publica: Buffer;
  contador: number;
  transportes: string[];
}

export async function passkeysDe(base: BaseApp, usuarioId: string): Promise<PasskeyGuardada[]> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<PasskeyGuardada>`select * from auth_passkeys(${usuarioId})`.execute(tx),
  );
  return rows;
}

export async function guardarPasskey(
  base: BaseApp,
  p: {
    id: string;
    usuarioId: string;
    credentialId: string;
    clave: Buffer;
    contador: number;
    transportes: string[];
    nombre: string;
  },
) {
  await sinKiosco(base, (tx) =>
    sql`select auth_guardar_passkey(${p.id}, ${p.usuarioId}, ${p.credentialId}, ${p.clave},
      ${p.contador}, ${p.transportes}::text[], ${p.nombre})`.execute(tx),
  );
}

export async function actualizarContadorPasskey(
  base: BaseApp,
  usuarioId: string,
  credentialId: string,
  contador: number,
) {
  await sinKiosco(base, (tx) =>
    sql`select auth_contador_passkey(${usuarioId}, ${credentialId}, ${contador})`.execute(tx),
  );
}

export async function listarPasskeys(base: BaseApp, usuarioId: string) {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{
      id: string;
      nombre: string;
      created_at: Date;
    }>`select * from auth_listar_passkeys(${usuarioId})`.execute(tx),
  );
  return rows;
}

export async function borrarPasskey(
  base: BaseApp,
  usuarioId: string,
  id: string,
): Promise<boolean> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{ ok: boolean }>`select auth_borrar_passkey(${usuarioId}, ${id}) as ok`.execute(tx),
  );
  return rows[0]?.ok === true;
}
