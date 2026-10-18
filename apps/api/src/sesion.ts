// Plugin de sesión: lee la cookie, verifica la sesión en el servidor y aplica los permisos de
// cada ruta con deniego por defecto (sección 3 de docs/SPEC.md).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withKiosco, type TxKiosco } from '@mostrador/db';
import {
  leerSesion,
  type RolSesion,
  type Sesion,
  type SesionCompleta,
} from './servicios/sesiones.ts';
import { sinPermiso } from './errores.ts';
import { auditar } from './servicios/auditoria.ts';
import {
  crearLimitePorClave,
  leerClaveApi,
  type ClaveApi,
  type PermisoApi,
} from './servicios/claves-api.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Solo las rutas marcadas como públicas se atienden sin sesión. */
    publica?: boolean;
    /** Rutas del paso de segundo factor: aceptan la sesión pendiente. */
    pendiente?: boolean;
    /** Roles que pueden usar la ruta. Si falta, nadie puede (deniego por defecto). */
    roles?: readonly RolSesion[];
    /**
     * Ruta de la API para los comercios (docs/API.md): se entra solo con una clave de API, nunca
     * con la cookie. `permisoApi` pide además ese permiso en la clave.
     */
    externa?: boolean;
    permisoApi?: PermisoApi;
  }
  interface FastifyRequest {
    sesion: Sesion | null;
    /** Clave de API verificada. Solo en rutas `externa`. */
    clave: ClaveApi | null;
    /** Sesión completa (con kiosco y rol). Solo en rutas con `roles`. */
    completa: SesionCompleta;
    /** Ejecuta `fn` en una transacción con el kiosco de la sesión (RLS). */
    db<T>(fn: (tx: TxKiosco) => Promise<T>): Promise<T>;
  }
}

export const NOMBRE_COOKIE_SEGURA = '__Host-mostrador';
export const NOMBRE_COOKIE_DEV = 'mostrador_sesion';

export function nombreCookie(app: FastifyInstance): string {
  return app.config.cookiesSeguras ? NOMBRE_COOKIE_SEGURA : NOMBRE_COOKIE_DEV;
}

export function ponerCookieSesion(app: FastifyInstance, reply: FastifyReply, token: string) {
  reply.setCookie(nombreCookie(app), token, {
    httpOnly: true,
    secure: app.config.cookiesSeguras,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 3600,
  });
}

export function borrarCookieSesion(app: FastifyInstance, reply: FastifyReply) {
  reply.clearCookie(nombreCookie(app), { path: '/' });
}

const noAutorizado = (req: FastifyRequest, reply: FastifyReply) =>
  reply
    .code(401)
    .send({ error: 'Tu sesión venció. Volvé a entrar.', codigo: 'sin_sesion', id: req.id });

export async function registrarSesion(app: FastifyInstance): Promise<void> {
  app.decorateRequest('sesion', null);
  app.decorateRequest('clave', null);
  app.decorateRequest('completa', null as unknown as SesionCompleta);
  app.decorateRequest('db', function <T>(this: FastifyRequest, fn: (tx: TxKiosco) => Promise<T>) {
    if (this.clave) return withKiosco(app.base, this.clave.kioscoId, fn);
    const s = this.sesion;
    if (!s?.kioscoId || s.tipo !== 'completa') throw sinPermiso();
    return withKiosco(app.base, s.kioscoId, fn);
  });

  const limiteClave = crearLimitePorClave(120);

  app.addHook('onRequest', async (req, reply) => {
    if (req.is404) return;
    const config = req.routeOptions.config;

    // API para los comercios: solo con clave. La cookie no se lee ni sirve.
    if (config.externa === true) {
      const clave = await leerClaveApi(app.base, req.headers.authorization);
      if (!clave) {
        return reply.code(401).send({
          error: 'La clave de API no es válida o fue revocada.',
          codigo: 'clave_invalida',
          id: req.id,
        });
      }
      if (!limiteClave(clave.id)) {
        return reply.code(429).send({
          error: 'Demasiados pedidos con esta clave. Esperá un minuto.',
          codigo: 'demasiados_pedidos',
          id: req.id,
        });
      }
      if (config.permisoApi && !clave.permisos.includes(config.permisoApi)) {
        return reply.code(403).send({
          error: 'Esta clave no tiene permiso para ver estos datos.',
          codigo: 'sin_permiso',
          id: req.id,
        });
      }
      req.clave = clave;
      return;
    }
    const token = req.cookies[nombreCookie(app)];
    req.sesion = token ? await leerSesion(app.base, token) : null;

    if (config.publica === true) return;
    const s = req.sesion;
    if (!s) return noAutorizado(req, reply);

    if (config.pendiente === true) {
      return; // el handler verifica el paso que corresponde
    }
    if (s.tipo !== 'completa' || !s.kioscoId || !s.rol) return noAutorizado(req, reply);
    // Deniego por defecto: una ruta sin `roles` no la puede usar nadie.
    if (!config.roles?.includes(s.rol)) {
      return reply
        .code(403)
        .send({ error: sinPermiso().message, codigo: 'sin_permiso', id: req.id });
    }
    req.completa = s as SesionCompleta;
  });

  // Todo lo que hace soporte queda auditado y visible para el dueño.
  app.addHook('onResponse', async (req, reply) => {
    const s = req.sesion;
    if (!s?.esSoporte || !s.kioscoId || req.method === 'GET' || req.is404) return;
    await withKiosco(app.base, s.kioscoId, (tx) =>
      auditar(
        tx,
        s,
        'soporte.accion',
        { metodo: req.method, ruta: req.routeOptions.url, estado: reply.statusCode },
        req.ip,
      ),
    ).catch((err: unknown) => req.log.error({ err }, 'No se pudo auditar la acción de soporte'));
  });
}
