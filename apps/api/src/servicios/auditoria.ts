import type { TxKiosco } from '@mostrador/db';
import { uuidv7 } from '@mostrador/shared';
import type { Sesion } from './sesiones.ts';

/** Agrega una fila a la auditoría del kiosco de la transacción. Nunca guarda secretos. */
export async function auditar(
  tx: TxKiosco,
  sesion: Pick<Sesion, 'usuarioId' | 'kioscoId' | 'esSoporte'>,
  accion: string,
  detalle: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  if (!sesion.kioscoId) return;
  await tx
    .insertInto('auditoria')
    .values({
      id: uuidv7(),
      kiosco_id: sesion.kioscoId,
      usuario_id: sesion.usuarioId,
      es_soporte: sesion.esSoporte,
      accion,
      detalle: JSON.stringify(detalle),
      ip,
    })
    .execute();
}
