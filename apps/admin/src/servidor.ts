import { cerrarBaseApp, crearBaseApp } from '@mostrador/db';
import { crearCifrador, leerClaves } from '@mostrador/servidor';
import { construirPanel } from './app.ts';

const requerida = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}`);
  return v;
};

const base = crearBaseApp(requerida('DATABASE_PANEL_URL'), 3);
const { claves, actual } = leerClaves();
const panel = await construirPanel(base, await crearCifrador(claves, actual), {
  origen: requerida('PANEL_ORIGEN'),
  origenApp: requerida('APP_ORIGEN'),
  cookiesSeguras: process.env['COOKIES_INSEGURAS'] !== '1',
});

const cerrar = async () => {
  await panel.close();
  await cerrarBaseApp(base);
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);

// Escuchar solo en la IP de Tailscale (o 127.0.0.1 detrás de un túnel). Nunca 0.0.0.0 en producción.
await panel.listen({
  host: process.env['PANEL_HOST'] ?? '127.0.0.1',
  port: Number(process.env['PANEL_PUERTO'] ?? 8081),
});
