// Entrega de avisos a los webhooks de un comercio: busca a quién mandarlo, lo firma, lo manda y
// anota cómo salió. La usa el worker (con reintentos) y la API cuando no hay cola.
import { withKiosco, type BaseApp } from '@mostrador/db';
import {
  enviarAviso,
  firmarAviso,
  problemaDeUrl,
  type EventoAviso,
  type OpcionesEnvio,
} from './avisos.ts';
import type { Cifrador } from './cifrado.ts';

/** Lo que recibe la herramienta del comercio. */
export interface Aviso {
  /** Único por aviso: si llega dos veces (por un reintento), se descarta el repetido. */
  id: string;
  evento: EventoAviso | 'prueba';
  /** ISO 8601 */
  creado: string;
  datos: unknown;
}

/** Después de tantos intentos fallidos seguidos, el webhook se pausa y el dueño lo ve. */
export const FALLOS_PARA_PAUSAR = 50;

/** IDs de los webhooks activos del comercio que esperan este evento. */
export async function destinosDeAviso(
  base: BaseApp,
  kioscoId: string,
  evento: EventoAviso,
): Promise<string[]> {
  const filas = await withKiosco(base, kioscoId, (tx) =>
    tx
      .selectFrom('webhooks')
      .select('id')
      .where('activo', '=', true)
      .where('eventos', '@>', [evento])
      .execute(),
  );
  return filas.map((f) => f.id);
}

/**
 * Manda un aviso a un webhook. Devuelve `reintentar: true` si falló y conviene probar más tarde.
 * Si el webhook ya no existe o está pausado, no hace nada.
 */
export async function entregarAviso(
  base: BaseApp,
  cifrador: Cifrador,
  kioscoId: string,
  webhookId: string,
  aviso: Aviso,
  opciones: OpcionesEnvio = {},
): Promise<{ enviado: boolean; reintentar: boolean; estado: string }> {
  const w = await withKiosco(base, kioscoId, (tx) =>
    tx
      .selectFrom('webhooks')
      .select(['url', 'secreto_cifrado', 'clave_version', 'activo', 'fallos_seguidos'])
      .where('id', '=', webhookId)
      .executeTakeFirst(),
  );
  if (!w || (!w.activo && aviso.evento !== 'prueba'))
    return { enviado: false, reintentar: false, estado: 'Sin destino.' };

  const problema = problemaDeUrl(w.url);
  const cuerpo = JSON.stringify(aviso);
  const r = problema
    ? { ok: false, estado: problema }
    : await enviarAviso(
        new URL(w.url),
        cuerpo,
        {
          'x-mostrador-evento': aviso.evento,
          'x-mostrador-id': aviso.id,
          'x-mostrador-firma': firmarAviso(
            cifrador.descifrar(w.secreto_cifrado, w.clave_version).toString('utf8'),
            Math.floor(Date.now() / 1000),
            cuerpo,
          ),
        },
        opciones,
      );

  const fallos = r.ok ? 0 : w.fallos_seguidos + 1;
  await withKiosco(base, kioscoId, (tx) =>
    tx
      .updateTable('webhooks')
      .set({
        ultimo_envio: new Date(),
        ultimo_estado: r.estado.slice(0, 120),
        fallos_seguidos: fallos,
        ...(fallos >= FALLOS_PARA_PAUSAR ? { activo: false } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', webhookId)
      .execute(),
  );
  return { enviado: r.ok, reintentar: !r.ok && !problema, estado: r.estado };
}
