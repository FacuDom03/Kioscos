// Colas de trabajos (Redis + BullMQ): Mercado Pago y avisos automáticos. La API solo encola; el
// worker procesa.
import type { Aviso } from '@mostrador/servidor';
import { Queue } from 'bullmq';

export const COLA_MP = 'mercadopago';
export const COLA_AVISOS = 'avisos';

export interface ColaMp {
  encolar(ordenId: string): Promise<void>;
  cerrar(): Promise<void>;
}

export function conexionRedis(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
  };
}

export async function crearColaMp(url: string | undefined): Promise<ColaMp | null> {
  if (!url) return null;
  const cola = new Queue(COLA_MP, { connection: conexionRedis(url) });
  return {
    async encolar(ordenId) {
      // Un trabajo por orden a la vez; reintentos con espera creciente.
      await cola.add(
        'orden',
        { ordenId },
        {
          jobId: `orden-${ordenId}-${Date.now()}`,
          attempts: 6,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
    },
    cerrar: () => cola.close(),
  };
}

export interface TrabajoAviso {
  kioscoId: string;
  aviso: Aviso;
}

export interface ColaAvisos {
  encolar(trabajo: TrabajoAviso): Promise<void>;
  cerrar(): Promise<void>;
}

export async function crearColaAvisos(url: string | undefined): Promise<ColaAvisos | null> {
  if (!url) return null;
  const cola = new Queue(COLA_AVISOS, { connection: conexionRedis(url) });
  return {
    async encolar(trabajo) {
      // El worker lo reparte en una entrega por webhook, cada una con sus reintentos.
      await cola.add('aviso', trabajo, {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    cerrar: () => cola.close(),
  };
}
