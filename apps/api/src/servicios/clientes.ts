// Saldo de la cuenta corriente de un cliente (etapa I5): la suma de sus movimientos.
import type { TxKiosco } from '@mostrador/db';

export async function saldoDe(tx: TxKiosco, clienteId: string): Promise<number> {
  const r = await tx
    .selectFrom('movimientos_cuenta')
    .select((eb) => eb.fn.sum<string>('monto').as('saldo'))
    .where('cliente_id', '=', clienteId)
    .executeTakeFirst();
  return Number(r?.saldo ?? 0);
}

/** Toma el cliente para cobrarle o anotarle algo (de a una operación por cliente). */
export async function clienteParaCuenta(tx: TxKiosco, clienteId: string) {
  return tx
    .selectFrom('clientes')
    .select(['id', 'nombre', 'limite', 'activo'])
    .where('id', '=', clienteId)
    .forUpdate()
    .executeTakeFirst();
}
