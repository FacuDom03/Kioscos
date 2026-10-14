import type { FastifyInstance } from 'fastify';
import { pingBase } from '@mostrador/db';

// Chequeo interno de salud. Caddy no la publica hacia afuera (ver docs/SPEC.md, sección 20).
export async function rutasSalud(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { publica: true } }, async (_req, reply) => {
    try {
      await pingBase(app.base);
      return { base: 'ok' };
    } catch {
      return reply.code(503).send({ base: 'error' });
    }
  });
}
