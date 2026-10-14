import { sql } from 'kysely';
import type { TxKiosco } from './con-kiosco.ts';
import { uuidv7 } from '@mostrador/shared';

export type TipoMovimiento = 'venta' | 'compra' | 'ajuste' | 'anulacion';

/**
 * Registra un movimiento de stock y actualiza `stock_actual` en la misma transacción.
 * Los movimientos solo se agregan; nunca se editan. El stock puede quedar negativo.
 */
export async function moverStock(
  tx: TxKiosco,
  m: {
    kioscoId: string;
    productoId: string;
    tipo: TipoMovimiento;
    cantidad: number;
    usuarioId: string;
    costoUnitario?: number | null;
    motivo?: string | null;
    ventaId?: string | null;
    compraId?: string | null;
  },
): Promise<{ stockNuevo: number }> {
  const fila = await tx
    .updateTable('productos')
    .set({ stock_actual: sql`stock_actual + ${m.cantidad}`, updated_at: new Date() })
    .where('id', '=', m.productoId)
    .returning('stock_actual')
    .executeTakeFirst();
  if (!fila) throw new Error('producto_inexistente');
  await tx
    .insertInto('movimientos_stock')
    .values({
      id: uuidv7(),
      kiosco_id: m.kioscoId,
      producto_id: m.productoId,
      tipo: m.tipo,
      cantidad: m.cantidad,
      costo_unitario: m.costoUnitario ?? null,
      motivo: m.motivo ?? null,
      venta_id: m.ventaId ?? null,
      compra_id: m.compraId ?? null,
      usuario_id: m.usuarioId,
    })
    .execute();
  return { stockNuevo: Number(fila.stock_actual) };
}
