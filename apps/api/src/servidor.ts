import { cerrarBaseApp, crearBaseApp } from '@mostrador/db';
import { construirApp } from './app.ts';
import { configDesdeEntorno } from './config.ts';
import { configMpDesdeEntorno } from '@mostrador/mp';
import { crearColaAvisos, crearColaMp } from './cola.ts';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('Falta la variable de entorno DATABASE_URL');

const base = crearBaseApp(url);
const config = configDesdeEntorno();
const cola = await crearColaMp(process.env['REDIS_URL']);
const colaAvisos = await crearColaAvisos(process.env['REDIS_URL']);
const app = await construirApp({
  base,
  config,
  logger: true,
  mp: configMpDesdeEntorno(config.origen),
  ...(cola ? { encolarOrdenMp: cola.encolar } : {}),
  ...(colaAvisos ? { encolarAviso: colaAvisos.encolar } : {}),
});

const cerrar = async () => {
  await app.close();
  await cola?.cerrar();
  await colaAvisos?.cerrar();
  await cerrarBaseApp(base);
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

await app.listen({
  host: process.env['HOST'] ?? '127.0.0.1',
  port: Number(process.env['PORT'] ?? 3000),
});
