import type { FastifyInstance } from 'fastify';
import { rutasSalud } from './salud.ts';

export async function registrarRutas(app: FastifyInstance): Promise<void> {
  await app.register(rutasSalud);
}
