// Worker: trabajos con reintentos, sin frenar la caja (sección 5).
// Mercado Pago (solo si está configurado):
// - "orden": reconsulta una orden que avisó un webhook verificado.
// - "pendientes": cada minuto, reconsulta los cobros QR sin confirmar (hasta 24 horas).
// - "renovar": todos los días, renueva los tokens que vencen en menos de 30 días.
// Avisos automáticos de los comercios (docs/API.md):
// - "aviso": lo reparte en una entrega por cada webhook que lo espera.
// - "entrega": lo manda a un webhook; si falla, reintenta con espera creciente.
// Facturas (docs/FACTURACION.md), solo con el token de Afip SDK, de a una por vez:
// - "factura": pide el CAE de un comprobante; si ARCA no responde, reintenta.
// - "revisar": cada dos minutos, lo pendiente de cada comercio y las autorizaciones a confirmar.
import { cerrarBaseApp, crearBaseApp } from '@mostrador/db';
import {
  ClienteMp,
  configMpDesdeEntorno,
  pagosPendientes,
  reconsultarOrden,
  reconsultarPago,
  renovarTokens,
} from '@mostrador/mp';
import {
  ClienteAfipSdk,
  crearCifrador,
  destinosDeAviso,
  entregarAviso,
  kioscosConFacturacion,
  leerClaves,
  procesarComprobante,
  revisarFacturacion,
  type Aviso,
} from '@mostrador/servidor';
import { Queue, Worker } from 'bullmq';

const requerida = (n: string) => {
  const v = process.env[n];
  if (!v) throw new Error(`Falta ${n}`);
  return v;
};

const redis = new URL(requerida('REDIS_URL'));
const conexion = {
  host: redis.hostname,
  port: Number(redis.port || 6379),
  ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}),
};

const base = crearBaseApp(requerida('DATABASE_URL'), 4);
const { claves, actual } = leerClaves();
const cifrador = await crearCifrador(claves, actual);
const cerrables: { close(): Promise<void> }[] = [];

const config = configMpDesdeEntorno(requerida('APP_ORIGEN'));
if (config) {
  const cliente = new ClienteMp(config);
  const cola = new Queue('mercadopago', { connection: conexion });
  await cola.upsertJobScheduler('pendientes', { every: 60_000 }, { name: 'pendientes' });
  await cola.upsertJobScheduler(
    'renovar',
    { pattern: '17 4 * * *', tz: 'America/Argentina/Buenos_Aires' },
    { name: 'renovar' },
  );
  const worker = new Worker(
    'mercadopago',
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
  cerrables.push(worker, cola);
} else {
  console.log('Mercado Pago no está configurado: el worker solo manda avisos.');
}

interface TrabajoAviso {
  kioscoId: string;
  aviso: Aviso;
  webhookId?: string;
}

const colaAvisos = new Queue<TrabajoAviso>('avisos', { connection: conexion });
const workerAvisos = new Worker<TrabajoAviso>(
  'avisos',
  async (job) => {
    const { kioscoId, aviso } = job.data;
    if (job.name === 'aviso') {
      if (aviso.evento === 'prueba') return { entregas: 0 };
      const destinos = await destinosDeAviso(base, kioscoId, aviso.evento);
      for (const webhookId of destinos)
        await colaAvisos.add(
          'entrega',
          { kioscoId, aviso, webhookId },
          {
            // Cinco intentos más: a los 30 s, 1, 2, 4 y 8 minutos.
            attempts: 6,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        );
      return { entregas: destinos.length };
    }
    if (job.name === 'entrega' && job.data.webhookId) {
      const r = await entregarAviso(base, cifrador, kioscoId, job.data.webhookId, aviso);
      if (r.reintentar) throw new Error(r.estado);
      return { estado: r.estado };
    }
    return null;
  },
  { connection: conexion, concurrency: 8 },
);
workerAvisos.on('failed', (job, err) =>
  console.error(`Aviso ${job?.name} falló (intento ${job?.attemptsMade}): ${err.message}`),
);
cerrables.push(workerAvisos, colaAvisos);

const tokenAfip = process.env['AFIPSDK_TOKEN']?.trim();
if (tokenAfip) {
  // Sin AFIPSDK_PRODUCCION=1, modo de prueba: CUIT de pruebas de ARCA, no vale como factura.
  const produccion = process.env['AFIPSDK_PRODUCCION'] === '1';
  const facturador = {
    cliente: new ClienteAfipSdk({ accessToken: tokenAfip, produccion }),
    prueba: !produccion,
  };
  const colaFacturas = new Queue('facturas', { connection: conexion });
  await colaFacturas.upsertJobScheduler('revisar', { every: 120_000 }, { name: 'revisar' });
  const workerFacturas = new Worker(
    'facturas',
    async (job) => {
      if (job.name === 'factura') {
        const { kioscoId, comprobanteId } = job.data as { kioscoId: string; comprobanteId: string };
        const r = await procesarComprobante(base, kioscoId, comprobanteId, facturador);
        if (r.estado === 'reintentar') throw new Error(r.motivo);
        return r;
      }
      if (job.name === 'revisar') {
        let autorizados = 0;
        for (const k of await kioscosConFacturacion(base)) {
          const r = await revisarFacturacion(base, k.kiosco_id, k.estado, facturador).catch(
            (err: unknown) => {
              console.error(`Revisión de facturas falló: ${(err as Error).message}`);
              return { autorizados: 0 };
            },
          );
          autorizados += r.autorizados;
        }
        return { autorizados };
      }
      return null;
    },
    // De a uno: la numeración de cada punto de venta tiene que ir en orden.
    { connection: conexion, concurrency: 1 },
  );
  workerFacturas.on('failed', (job, err) =>
    console.error(`Factura ${job?.name} falló (intento ${job?.attemptsMade}): ${err.message}`),
  );
  cerrables.push(workerFacturas, colaFacturas);
  console.log(`Facturación con Afip SDK ${produccion ? 'en producción' : 'en modo de prueba'}.`);
}

const cerrar = async () => {
  for (const c of cerrables) await c.close();
  await cerrarBaseApp(base);
  process.exit(0);
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
console.log('Worker de Mostrador andando');
