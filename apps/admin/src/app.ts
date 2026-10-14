// Panel interno de administración (solo para el dueño del SaaS). Se publica únicamente en la
// interfaz de Tailscale y usa el rol de base `mostrador_panel`, que solo puede ejecutar las
// funciones panel_* (ver packages/db/migrations/0004).
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { sinKiosco, sql, type BaseApp, type RawBuilder } from '@mostrador/db';
import {
  hashToken,
  tokenAleatorio,
  verificarPassword,
  verificarTotp,
  type Cifrador,
} from '@mostrador/servidor';
import { RUBROS, uuidv7 } from '@mostrador/shared';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface ConfigPanel {
  /** Origen del panel (http://100.x.y.z:8081 por Tailscale). CSRF. */
  origen: string;
  /** Origen de la app, para armar los enlaces de invitación y de soporte. */
  origenApp: string;
  cookiesSeguras: boolean;
}

const COOKIE = 'mostrador_panel';
const PUBLICO = new URL('../public/', import.meta.url);
const ARCHIVOS: Record<string, string> = {
  '/': 'index.html',
  '/panel.js': 'panel.js',
  '/panel.css': 'panel.css',
};
const TIPOS: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
};

class ErrorPanel extends Error {
  readonly status: number;
  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.status = status;
  }
}

function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const r = esquema.safeParse(datos);
  if (!r.success) throw new ErrorPanel(400, 'Revisá los datos.');
  return r.data;
}

const enlaceInvitacion = (config: ConfigPanel, token: string) =>
  `${config.origenApp}/invitacion#${token}`;

export async function construirPanel(
  base: BaseApp,
  cifrador: Cifrador,
  config: ConfigPanel,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, genReqId: () => randomUUID() });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  const q = <T>(consulta: RawBuilder<T>) => sinKiosco(base, (tx) => consulta.execute(tx));

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ErrorPanel) return reply.code(error.status).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error });
    return reply
      .code(status)
      .send({ error: status === 429 ? 'Demasiados intentos.' : 'Error', id: req.id });
  });

  for (const [ruta, archivo] of Object.entries(ARCHIVOS)) {
    app.get(ruta, async (_req, reply) => {
      const contenido = await readFile(new URL(archivo, PUBLICO));
      return reply.type(TIPOS[archivo.split('.').pop() ?? 'html'] ?? 'text/plain').send(contenido);
    });
  }

  async function sesion(req: FastifyRequest) {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    const { rows } = await q(
      sql<{
        admin_id: string;
        tipo: string;
        email: string;
      }>`select * from panel_leer_sesion(${hashToken(token)})`,
    );
    const s = rows[0];
    return s?.tipo === 'completa' ? s : null;
  }

  // CSRF y sesión para toda la API del panel salvo el login.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/panel/api/')) return;
    if (req.method !== 'GET' && req.headers.origin !== config.origen) {
      return reply.code(403).send({ error: 'Pedido rechazado' });
    }
    if (req.url === '/panel/api/login') return;
    const s = await sesion(req);
    if (!s) return reply.code(401).send({ error: 'Entrá de nuevo.' });
    (req as FastifyRequest & { admin: typeof s }).admin = s;
  });
  const admin = (req: FastifyRequest) =>
    (req as FastifyRequest & { admin: { admin_id: string; email: string } }).admin;

  app.post(
    '/panel/api/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply: FastifyReply) => {
      const d = validar(
        z.strictObject({
          email: z.email(),
          password: z.string().min(1).max(128),
          codigo: z.string().max(10),
        }),
        req.body,
      );
      const { rows } = await q(
        sql<{
          admin_id: string;
          password_hash: string;
          totp_secreto_cifrado: Buffer;
          totp_clave_version: number;
          bloqueado_hasta: Date | null;
        }>`select * from panel_credenciales(${d.email})`,
      );
      const a = rows[0];
      const invalido = new ErrorPanel(401, 'Email, contraseña o código incorrectos.');
      if (!a) {
        await verificarPassword(null, d.password);
        throw invalido;
      }
      if (a.bloqueado_hasta && a.bloqueado_hasta > new Date())
        throw new ErrorPanel(429, 'Cuenta bloqueada un rato.');
      const ok =
        (await verificarPassword(a.password_hash, d.password)) &&
        verificarTotp(cifrador.descifrar(a.totp_secreto_cifrado, a.totp_clave_version), d.codigo);
      await q(sql`select panel_registrar_intento(${a.admin_id}, ${ok})`);
      if (!ok) throw invalido;
      const token = tokenAleatorio();
      await q(
        sql`select panel_crear_sesion(${uuidv7()}, ${hashToken(token)}, ${a.admin_id}, 'completa', ${new Date(Date.now() + 8 * 3600_000)})`,
      );
      reply.setCookie(COOKIE, token, {
        httpOnly: true,
        secure: config.cookiesSeguras,
        sameSite: 'strict',
        path: '/',
      });
      return { ok: true };
    },
  );

  app.post('/panel/api/salir', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await q(sql`select panel_borrar_sesion(${hashToken(token)})`);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/panel/api/yo', async (req) => ({ email: admin(req).email }));

  app.get('/panel/api/kioscos', async () => {
    const { rows } = await q(sql`select * from panel_listar_kioscos()`);
    return rows;
  });

  const plan = z.enum(['esencial', 'comercio']);

  app.post('/panel/api/kioscos', async (req) => {
    const d = validar(
      z.strictObject({
        nombre: z.string().trim().min(1).max(120),
        cuit: z
          .string()
          .regex(/^\d{11}$/)
          .or(z.literal(''))
          .optional(),
        plan,
        rubro: z.enum(RUBROS),
        emailDueno: z.email().max(254),
      }),
      req.body,
    );
    const id = uuidv7();
    const token = tokenAleatorio();
    await q(
      sql`select panel_crear_kiosco(${id}, ${d.nombre}, ${d.cuit ?? ''}, ${d.plan}, ${d.rubro}, ${uuidv7()}, ${uuidv7()},
        ${d.emailDueno}, ${hashToken(token)}, ${new Date(Date.now() + 72 * 3600_000)}, ${admin(req).admin_id})`,
    );
    return { id, enlace: enlaceInvitacion(config, token) };
  });

  app.patch('/panel/api/kioscos/:id', async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    const d = validar(
      z.strictObject({
        plan,
        estado: z.enum(['prueba', 'activa', 'vencida', 'suspendida', 'baja']),
      }),
      req.body,
    );
    const { rows } = await q(
      sql<{
        ok: boolean;
      }>`select panel_actualizar_kiosco(${id}, ${d.plan}, ${d.estado}, ${admin(req).admin_id}) as ok`,
    );
    if (!rows[0]?.ok) throw new ErrorPanel(404, 'No existe ese kiosco.');
    return { ok: true };
  });

  app.post('/panel/api/kioscos/:id/invitacion', async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    const { email } = validar(z.strictObject({ email: z.email().max(254) }), req.body);
    const token = tokenAleatorio();
    await q(
      sql`select panel_nueva_invitacion_dueno(${id}, ${uuidv7()}, ${email}, ${hashToken(token)}, ${new Date(Date.now() + 72 * 3600_000)})`,
    );
    return { enlace: enlaceInvitacion(config, token) };
  });

  app.post('/panel/api/kioscos/:id/soporte', async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    validar(z.strictObject({}).optional(), req.body);
    const token = tokenAleatorio();
    const a = admin(req);
    const { rows } = await q(
      sql<{
        ok: boolean;
      }>`select panel_crear_sesion_soporte(${a.admin_id}, ${id}, ${a.admin_id}, ${uuidv7()}, ${hashToken(token)}) as ok`,
    );
    if (!rows[0]?.ok) throw new ErrorPanel(409, 'El dueño no activó el acceso de soporte.');
    return { enlace: `${config.origenApp}/soporte#${token}` };
  });

  return app;
}
