// Sesiones del servidor: cookie HttpOnly con un token aleatorio; en la base, solo su hash.
import { sinKiosco, type BaseApp, type Rol } from '@mostrador/db';
import { uuidv7 } from '@mostrador/shared';
import { sql } from '@mostrador/db';
import { hashToken, tokenAleatorio } from '@mostrador/servidor';

export type RolSesion = Rol | 'soporte';

export interface Sesion {
  id: string;
  tokenHash: string;
  usuarioId: string;
  kioscoId: string | null;
  rol: RolSesion | null;
  dispositivoId: string | null;
  tipo: 'completa' | 'pendiente_2fa';
  esSoporte: boolean;
  nombre: string;
  email: string | null;
  desafio: string | null;
}

/** Sesión completa: ya tiene kiosco y rol. */
export interface SesionCompleta extends Sesion {
  kioscoId: string;
  rol: RolSesion;
  tipo: 'completa';
}

const HORA = 3600;
export const DURACIONES = {
  pendiente: { absoluta: 10 * 60, inactividad: null },
  // La sesión de un turno dura como máximo 12 horas.
  turno: { absoluta: 12 * HORA, inactividad: null },
  // El dueño fuera de la caja: 30 minutos de inactividad (y nunca más de 12 horas).
  dueno: { absoluta: 12 * HORA, inactividad: 30 * 60 },
} as const;

export function duracionPara(rol: RolSesion) {
  return rol === 'dueno' ? DURACIONES.dueno : DURACIONES.turno;
}

const enSegundos = (s: number) => new Date(Date.now() + s * 1000);

export async function crearSesion(
  base: BaseApp,
  datos: {
    usuarioId: string;
    kioscoId: string | null;
    rol: RolSesion | null;
    dispositivoId?: string | null;
    tipo: 'completa' | 'pendiente_2fa';
  },
): Promise<string> {
  const token = tokenAleatorio();
  const d =
    datos.tipo === 'pendiente_2fa' || !datos.rol ? DURACIONES.pendiente : duracionPara(datos.rol);
  await sinKiosco(base, (tx) =>
    sql`select auth_crear_sesion(${uuidv7()}, ${hashToken(token)}, ${datos.usuarioId}, ${datos.kioscoId},
          ${datos.rol}, ${datos.dispositivoId ?? null}, ${datos.tipo}, ${enSegundos(d.absoluta)},
          ${d.inactividad}, false)`.execute(tx),
  );
  return token;
}

export async function leerSesion(base: BaseApp, token: string): Promise<Sesion | null> {
  const tokenHash = hashToken(token);
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{
      id: string;
      usuario_id: string;
      kiosco_id: string | null;
      rol: RolSesion | null;
      dispositivo_id: string | null;
      tipo: 'completa' | 'pendiente_2fa';
      es_soporte: boolean;
      nombre: string;
      email: string | null;
      desafio: string | null;
    }>`select * from auth_leer_sesion(${tokenHash})`.execute(tx),
  );
  const s = rows[0];
  if (!s) return null;
  return {
    id: s.id,
    tokenHash,
    usuarioId: s.usuario_id,
    kioscoId: s.kiosco_id,
    rol: s.rol,
    dispositivoId: s.dispositivo_id,
    tipo: s.tipo,
    esSoporte: s.es_soporte,
    nombre: s.nombre,
    email: s.email,
    desafio: s.desafio,
  };
}

/** Pasa a sesión completa (o cambia de kiosco) rotando el token. Devuelve el token nuevo. */
export async function completarSesion(
  base: BaseApp,
  tokenHashViejo: string,
  kioscoId: string,
  rol: Rol,
): Promise<string> {
  const token = tokenAleatorio();
  const d = duracionPara(rol);
  await sinKiosco(base, (tx) =>
    sql`select auth_completar_sesion(${tokenHashViejo}, ${hashToken(token)}, ${kioscoId}, ${rol},
          ${enSegundos(d.absoluta)}, ${d.inactividad})`.execute(tx),
  );
  return token;
}

export async function guardarDesafio(base: BaseApp, tokenHash: string, desafio: string | null) {
  await sinKiosco(base, (tx) =>
    sql`select auth_guardar_desafio(${tokenHash}, ${desafio})`.execute(tx),
  );
}

export async function borrarSesion(base: BaseApp, tokenHash: string): Promise<void> {
  await sinKiosco(base, (tx) => sql`select auth_borrar_sesion(${tokenHash})`.execute(tx));
}

export async function borrarOtrasSesiones(base: BaseApp, usuarioId: string, salvo: string | null) {
  await sinKiosco(base, (tx) =>
    sql`select auth_borrar_sesiones_usuario(${usuarioId}, ${salvo})`.execute(tx),
  );
}

export interface Membresia {
  kiosco_id: string;
  nombre: string;
  rol: Rol;
  estado_suscripcion: string;
}

export async function membresiasDe(base: BaseApp, usuarioId: string): Promise<Membresia[]> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<Membresia>`select * from auth_membresias(${usuarioId})`.execute(tx),
  );
  return rows;
}
