// Worker: trabajos de Mercado Pago con reintentos, sin frenar la caja (sección 5).
// - "orden": reconsulta una orden que avisó un webhook verificado.
// - "pendientes": cada minuto, reconsulta los cobros QR sin confirmar (hasta 24 horas).
// - "renovar": todos los días, renueva los tokens que vencen en menos de 30 días.
import { cerrarBaseApp, crearBaseApp } from '@mostrador/db';
import {
  ClienteMp,
  configMpDesdeEntorno,
  pagosPendientes,
  reconsultarOrden,
  reconsultarPago,
  renovarTokens,
} from '@mostrador/mp';
import { crearCifrador, leerClaves } from '@mostrador/servidor';
import { Queue, Worker } from 'bullmq';

const requerida = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}`);
  return v;
};

const COLA = 'mercadopago';
const redis = new URL(requerida('REDIS_URL'));
const conexion = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}),
};

const config = configMpDesdeEntorno(requerida('APP_ORIGEN'));
if (!config) {
  console.log('Mercado Pago no está configurado: el worker no tiene nada que hacer.');
  process.exit(0);
}
const base = crearBaseApp(requerida('DATABASE_URL'), 4);
const { claves, actual } = leerClaves();
const cifrador = await crearCifrador(claves, actual);
const cliente = new ClienteMp(config);

const cola = new Queue(COLA, { connection: conexion });
await cola.upsertJobScheduler('pendientes', { every: 60_000 }, { name: 'pendientes' });
await cola.upsertJobScheduler(
  'renovar',
  { pattern: '17 4 * * *', tz: 'America/Argentina/Buenos_Aires' },
  { name: 'renovar' },
);

const worker = new Worker(
  COLA,
  async (job) => {
    if (job.name === 'orden') {
      const r = await reconsultarOrden(base, cifrador, cliente, String(job.data.ordenId));
      return { resultado: r };
    }
    if (job.name === 'pendientes') {
      let n = 0;
      for (const p of await pagosPendientes(base)) {
        await reconsultarPago(base, cifrador, cliente, p.kiosco_id, p.pago_id).catch(
          () => undefined,
        );
        n++;
      }
      return { revisados: n };
    }
    if (job.name === 'renovar') return renovarTokens(base, cifrador, cliente);
    return null;
  },
  { connection: conexion, concurrency: 4 },
);

worker.on('failed', (job, err) => console.error(`Trabajo ${job?.name} falló: ${err.message}`));

const cerrar = async () => {
  await worker.close();
  await cola.close();
  await cerrarBaseApp(base);
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
console.log('Worker de Mostrador andando');
