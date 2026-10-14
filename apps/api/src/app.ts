import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { BaseApp } from '@mostrador/db';
import { randomUUID } from 'node:crypto';
import { registrarRutas } from './routes/index.ts';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Solo las rutas marcadas como públicas se atienden sin sesión. Por defecto, se niega. */
    publica?: boolean;
  }
  interface FastifyInstance {
    base: BaseApp;
    /** "MÉTODO /url" de cada ruta registrada; lo usa la prueba de cobertura de rutas. */
    rutasRegistradas: string[];
  }
}

// Nunca loguear secretos ni datos personales (regla 5 de docs/SPEC.md, sección 18).
const REDACTAR = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.contrasena',
  '*.pin',
  '*.token',
  '*.access_token',
  '*.refresh_token',
  '*.email',
  '*.cuit',
];

export interface OpcionesApp {
  base: BaseApp;
  logger?: FastifyServerOptions['logger'];
}

export async function construirApp({
  base,
  logger = false,
}: OpcionesApp): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger === true ? { redact: REDACTAR } : logger,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 256 * 1024,
  });
  app.decorate('base', base);

  const rutasRegistradas: string[] = [];
  app.decorate('rutasRegistradas', rutasRegistradas);
  app.addHook('onRoute', (ruta) => {
    const metodos = Array.isArray(ruta.method) ? ruta.method : [ruta.method];
    for (const m of metodos) if (m !== 'HEAD') rutasRegistradas.push(`${m} ${ruta.url}`);
  });

  // Deniego por defecto: hasta que exista la sesión (Etapa B), toda ruta no pública responde 401.
  app.addHook('onRequest', async (req, reply) => {
    if (req.is404 || req.routeOptions.config.publica === true) return;
    return reply.code(401).send({ error: 'No autorizado', id: req.id });
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('cache-control', 'no-store');
  });

  // Errores genéricos al usuario; el detalle va al log con el ID de correlación.
  app.setErrorHandler((error, req, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    req.log.error({ err: error }, 'Error en la ruta');
    return reply
      .code(status >= 400 && status < 500 ? status : 500)
      .send({ error: status < 500 ? 'Pedido inválido' : 'Algo salió mal', id: req.id });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: 'No encontrado', id: req.id }),
  );

  await registrarRutas(app);
  return app;
}
