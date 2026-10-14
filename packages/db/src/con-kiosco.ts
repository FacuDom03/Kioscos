import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import { esUuid } from '@mostrador/shared';
import { crearPool } from './conexion.ts';
import type { Database } from './tipos.ts';

/** Transacción ya atada a un kiosco: toda consulta hecha con ella pasa por RLS de ese kiosco. */
export type TxKiosco = Transaction<Database>;

declare const marca: unique symbol;
/**
 * Conexión de la API. Es opaca a propósito: la única forma de consultar es `withKiosco`.
 * Ver la regla de ESLint en eslint.config.js y la prueba de apps/api.
 */
export interface BaseApp {
  readonly [marca]: true;
}

interface BaseInterna extends BaseApp {
  readonly kysely: Kysely<Database>;
}

export function crearBaseApp(connectionString: string, max = 10): BaseApp {
  const kysely = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: crearPool(connectionString, { max }) }),
  });
  return { kysely } as BaseInterna;
}

export async function cerrarBaseApp(base: BaseApp): Promise<void> {
  await (base as BaseInterna).kysely.destroy();
}

/**
 * Abre una transacción, fija `app.kiosco_id` solo para esa transacción y ejecuta `fn`.
 * El `kioscoId` tiene que salir de la sesión verificada en el servidor, nunca del pedido.
 */
export async function withKiosco<T>(
  base: BaseApp,
  kioscoId: string,
  fn: (tx: TxKiosco) => Promise<T>,
): Promise<T> {
  if (!esUuid(kioscoId)) {
    throw new TypeError('kioscoId inválido');
  }
  return (base as BaseInterna).kysely.transaction().execute(async (tx) => {
    await sql`select set_config('app.kiosco_id', ${kioscoId}, true)`.execute(tx);
    return fn(tx);
  });
}

/** Consulta sin kiosco, solo para chequeos de salud (`select 1`). No toca tablas. */
export async function pingBase(base: BaseApp): Promise<void> {
  await sql`select 1`.execute((base as BaseInterna).kysely);
}
