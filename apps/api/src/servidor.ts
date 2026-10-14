import { cerrarBaseApp, crearBaseApp } from '@mostrador/db';
import { construirApp } from './app.ts';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');

const base = crearBaseApp(url);
const app = await construirApp({ base, logger: true });

const cerrar = async () => {
  await app.close();
  await cerrarBaseApp(base);
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

await app.listen({
  host: process.env['HOST'] ?? '127.0.0.1',
  port: Number(process.env['PORT'] ?? 3000),
});
