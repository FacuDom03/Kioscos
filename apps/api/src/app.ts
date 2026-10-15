import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { sinKiosco, type BaseApp } from '@mostrador/db';
import { ClienteMp, reconsultarOrden, type ConfigMp } from '@mostrador/mp';
import { uuidv7 } from '@mostrador/shared';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { ErrorPublico } from './errores.ts';
import { registrarRutas } from './routes/index.ts';
import { crearCifrador, type Cifrador } from '@mostrador/servidor';
import { registrarSesion } from './sesion.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Rutas que reciben pedidos de terceros (webhooks): no se les pide el header Origin. */
    sinOrigen?: boolean;
  }
  interface FastifyInstance {
    base: BaseApp;
    config: Config;
    cifrador: Cifrador;
    /** "MÉTODO /url" de cada ruta registrada; lo usa la prueba de cobertura de rutas. */
    rutasRegistradas: string[];
    /** Guarda el ID del evento de webhook. Devuelve false si ya se había recibido. */
    registrarEventoWebhook: (eventoId: string) => Promise<boolean>;
  }
}

// Nunca loguear secretos ni datos personales (regla 5 de docs/SPEC.md, sección 18).
const REDACTAR = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordActual',
  '*.contrasena',
  '*.pin',
  '*.codigo',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.email',
  '*.cuit',
  '*.telefono',
];

export interface OpcionesApp {
  base: BaseApp;
  config: Config;
  logger?: FastifyServerOptions['logger'];
  /** En pruebas se puede apagar el límite de pedidos. */
  limitarPedidos?: boolean;
  /** Configuración de Mercado Pago (null: no disponible en este servidor). */
  mp?: ConfigMp | null;
  /** Fetch para hablar con Mercado Pago (en pruebas, un servidor falso). */
  fetchMp?: typeof fetch;
  /** Encola la reconsulta de una orden. Por defecto se hace en este proceso. */
  encolarOrdenMp?: (ordenId: string) => Promise<void>;
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function construirApp({
  base,
  config,
  logger = false,
  limitarPedidos = true,
  mp = null,
  fetchMp,
  encolarOrdenMp,
}: OpcionesApp): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger === true ? { redact: REDACTAR } : logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
    trustProxy: process.env['TRUST_PROXY'] === '1',
  });
  app.decorate('base', base);
  app.decorate('config', config);
  app.decorate('cifrador', await crearCifrador(config.claves, config.claveActual));
  app.decorate('mp', mp ? { config: mp, cliente: new ClienteMp(mp, fetchMp) } : null);
  app.decorate(
    'encolarOrdenMp',
    encolarOrdenMp ??
      (async (ordenId: string) => {
        setImmediate(() => {
          if (!app.mp) return;
          reconsultarOrden(app.base, app.cifrador, app.mp.cliente, ordenId).catch((err: unknown) =>
            app.log.error({ err }, 'Reconsulta de orden'),
          );
        });
      }),
  );
  app.decorate('registrarEventoWebhook', async (eventoId: string) => {
    const r = await sinKiosco(base, (tx) =>
      tx
        .insertInto('eventos_webhook')
        .values({ id: uuidv7(), proveedor: 'mercadopago', evento_id: eventoId })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .execute(),
    );
    return r.length > 0;
  });

  const rutasRegistradas: string[] = [];
  app.decorate('rutasRegistradas', rutasRegistradas);
  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    for (const m of metodos) if (m !== 'HEAD') rutasRegistradas.push(`${m} ${ruta.url}`);
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    ...(limitarPedidos ? {} : { allowList: () => true }),
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: ctx.statusCode,
      error: 'Demasiados intentos. Esperá un momento y probá de nuevo.',
      codigo: 'demasiados_pedidos',
    }),
  });

  // CSRF: además de SameSite, todo lo que modifica datos tiene que venir de nuestro origen.
  app.addHook('onRequest', async (req, reply) => {
    if (METODOS_SEGUROS.has(req.method) || req.is404 || req.routeOptions.config.sinOrigen) return;
    if (req.headers.origin !== config.origen) {
      return reply.code(403).send({ error: 'Pedido rechazado', codigo: 'origen', id: req.id });
    }
  });

  await registrarSesion(app);

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
  });

  // Errores genéricos al usuario; el detalle va al log con el ID de correlación.
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ErrorPublico) {
      return reply
        .code(error.status)
        .send({ error: error.message, codigo: error.codigo, id: req.id });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) return reply.code(429).send(error);
    if (status >= 500) req.log.error({ err: error }, 'Error en la ruta');
    else req.log.warn({ err: error }, 'Pedido inválido');
    return reply.code(status >= 400 && status < 500 ? status : 500).send({
      error:
        status < 500
          ? 'Revisá los datos e intentá de nuevo.'
          : 'Algo salió mal. Probá de nuevo y, si sigue, avisanos con este código.',
      codigo: status < 500 ? 'pedido_invalido' : 'error_interno',
      id: req.id,
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply
      .code(404)
      .send({ error: 'No encontramos lo que buscás.', codigo: 'no_encontrado', id: req.id }),
  );

  await registrarRutas(app);
  return app;
}
