import type { TxKiosco } from '@mostrador/db';
import { uuidv7 } from '@mostrador/shared';
import { sql } from '@mostrador/db';
import { ErrorPublico } from '../errores.ts';

function traducirLimite(error: unknown): never {
  const msg = (error as { message?: string }).message ?? '';
  if (msg.includes('limite_plan')) {
    throw new ErrorPublico(
      409,
      'limite_plan',
      'Llegaste al máximo de usuarios de tu plan. Para sumar más, pasate al plan Comercio.',
    );
  }
  throw error;
}

/** Crea un cajero en el kiosco de la transacción. El límite del plan lo valida la base. */
export async function crearCajero(
  tx: TxKiosco,
  nombre: string,
): Promise<{ usuario: string; membresia: string }> {
  const ids = { usuario: uuidv7(), membresia: uuidv7() };
  await sql`select kiosco_crear_cajero(${ids.usuario}, ${ids.membresia}, ${nombre})`
    .execute(tx)
    .catch(traducirLimite);
  return ids;
}

export async function crearInvitacion(
  tx: TxKiosco,
  d: { id: string; email: string; rol: 'encargado'; tokenHash: string; creadaPor: string },
): Promise<void> {
  const vence = new Date(Date.now() + 72 * 3600 * 1000);
  await sql`select kiosco_crear_invitacion(${d.id}, ${d.email}, ${d.rol}, ${d.tokenHash}, ${vence}, ${d.creadaPor})`
    .execute(tx)
    .catch(traducirLimite);
}
