import type { FastifyInstance } from 'fastify';
import { rutasAuth } from './auth.ts';
import { rutasCuenta } from './cuenta.ts';
import { rutasDispositivos } from './dispositivos.ts';
import { rutasKiosco } from './kiosco.ts';
import { rutasSalud } from './salud.ts';
import { rutasUsuarios } from './usuarios.ts';

export async function registrarRutas(app: FastifyInstance): Promise<void> {
  await app.register(rutasSalud);
  await app.register(rutasAuth);
  await app.register(rutasCuenta);
  await app.register(rutasDispositivos);
  await app.register(rutasUsuarios);
  await app.register(rutasKiosco);
}
