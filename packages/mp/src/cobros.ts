// Aplicar el estado de una orden QR de Mercado Pago a la venta. Lo usan la API (reconsulta
// mientras la pantalla de cobro está abierta) y el worker (webhooks y pendientes).
// Nunca se confía en lo que dice un webhook: siempre se reconsulta la orden en la API.
import { moverStock, type TxKiosco } from '@mostrador/db';
import type { Cifrador } from '@mostrador/servidor';
import type { Orden } from './cliente.ts';

export interface Integracion {
  id: string;
  estado: string;
  mpUserId: string;
  accessToken: string;
  refreshToken: string | null;
  venceEn: Date | null;
  externalPosId: string | null;
}

export async function integracionDelKiosco(
  tx: TxKiosco,
  cifrador: Cifrador,
): Promise<Integracion | null> {
  const i = await tx
    .selectFrom('integraciones')
    .selectAll()
    .where('proveedor', '=', 'mercadopago')
    .executeTakeFirst();
  if (
    !i ||
    i.estado === 'desconectado' ||
    !i.access_token_cifrado ||
    i.clave_version == null ||
    !i.mp_user_id
  )
    return null;
  return {
    id: i.id,
    estado: i.estado,
    mpUserId: i.mp_user_id,
    accessToken: cifrador.descifrar(i.access_token_cifrado, i.clave_version).toString('utf8'),
    refreshToken: i.refresh_token_cifrado
      ? cifrador.descifrar(i.refresh_token_cifrado, i.clave_version).toString('utf8')
      : null,
    venceEn: i.vence_en,
    externalPosId: i.mp_external_pos_id,
  };
}

export type ResultadoOrden = 'aprobado' | 'pendiente' | 'cancelado' | 'vencido' | 'ignorada';

const aCentavos = (monto: string | undefined) =>
  monto === undefined ? NaN : Math.round(Number(monto) * 100);

/**
 * Verifica que la orden corresponda a este pago (misma orden, misma venta, mismo monto y misma
 * cuenta de Mercado Pago del kiosco) y aplica su estado en una transacción.
 */
export async function aplicarOrden(
  tx: TxKiosco,
  pagoId: string,
  orden: Orden,
  mpUserIdDelKiosco: string,
): Promise<ResultadoOrden> {
  const pago = await tx
    .selectFrom('pagos')
    .selectAll()
    .where('id', '=', pagoId)
    .forUpdate()
    .executeTakeFirst();
  if (!pago || pago.medio !== 'qr_mp' || pago.mp_order_id !== orden.id) return 'ignorada';
  if (orden.external_reference !== pago.venta_id) return 'ignorada';
  if (aCentavos(orden.total_amount) !== pago.monto) return 'ignorada';
  if (orden.user_id !== undefined && String(orden.user_id) !== mpUserIdDelKiosco) return 'ignorada';

  await tx
    .updateTable('pagos')
    .set({ ultima_consulta: new Date() })
    .where('id', '=', pagoId)
    .execute();
  if (pago.estado === 'aprobado') return 'aprobado';
  if (pago.estado !== 'pendiente') return pago.estado === 'cancelado' ? 'cancelado' : 'vencido';

  const venta = await tx
    .selectFrom('ventas')
    .select(['id', 'estado', 'usuario_id', 'kiosco_id'])
    .where('id', '=', pago.venta_id)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const aprobada = orden.status === 'processed' || orden.status_detail === 'accredited';

  if (aprobada) {
    await tx
      .updateTable('pagos')
      .set({
        estado: 'aprobado',
        confirmado_en: new Date(),
        mp_payment_id: orden.transactions?.payments?.[0]?.id ?? null,
        updated_at: new Date(),
      })
      .where('id', '=', pagoId)
      .execute();
    if (venta.estado === 'abierta' || venta.estado === 'pendiente_cobro') {
      await tx
        .updateTable('ventas')
        .set({ estado: 'cobrada' })
        .where('id', '=', venta.id)
        .execute();
      const items = await tx
        .selectFrom('venta_items')
        .select(['producto_id', 'cantidad'])
        .where('venta_id', '=', venta.id)
        .execute();
      for (const i of items) {
        if (i.producto_id) {
          await moverStock(tx, {
            kioscoId: venta.kiosco_id,
            productoId: i.producto_id,
            tipo: 'venta',
            cantidad: -Number(i.cantidad),
            usuarioId: venta.usuario_id,
            ventaId: venta.id,
          });
        }
      }
    }
    // Si la venta se había anulado (por ejemplo, el cajero canceló pero el cliente ya pagó),
    // queda anulada con devolución pendiente para que el dueño la resuelva.
    if (venta.estado === 'anulada') {
      await tx
        .updateTable('ventas')
        .set({ devolucion_pendiente: true })
        .where('id', '=', venta.id)
        .execute();
    }
    return 'aprobado';
  }

  if (orden.status === 'canceled') {
    await tx
      .updateTable('pagos')
      .set({ estado: 'cancelado', updated_at: new Date() })
      .where('id', '=', pagoId)
      .execute();
    if (venta.estado === 'abierta' || venta.estado === 'pendiente_cobro') {
      await tx
        .updateTable('ventas')
        .set({
          estado: 'anulada',
          anulada_en: new Date(),
          motivo_anulacion: 'Cobro con QR cancelado',
        })
        .where('id', '=', venta.id)
        .execute();
    }
    return 'cancelado';
  }

  if (orden.status === 'expired') {
    await tx
      .updateTable('pagos')
      .set({ estado: 'vencido', updated_at: new Date() })
      .where('id', '=', pagoId)
      .execute();
    if (venta.estado === 'abierta')
      await tx
        .updateTable('ventas')
        .set({ estado: 'pendiente_cobro' })
        .where('id', '=', venta.id)
        .execute();
    return 'vencido';
  }

  // Sigue esperando. Pasados los 10 minutos, la venta queda pendiente de cobro para resolver.
  if (pago.vence_en && pago.vence_en < new Date() && venta.estado === 'abierta') {
    await tx
      .updateTable('ventas')
      .set({ estado: 'pendiente_cobro' })
      .where('id', '=', venta.id)
      .execute();
  }
  return 'pendiente';
}

/** ID estable de la caja de Mercado Pago del kiosco (hasta 40 caracteres alfanuméricos). */
export function externalPosId(kioscoId: string): string {
  return `MOSTRADOR${kioscoId.replace(/-/g, '').toUpperCase()}`.slice(0, 40);
}
export function externalStoreId(kioscoId: string): string {
  return `MOSTRADORS${kioscoId.replace(/-/g, '').toUpperCase()}`.slice(0, 60);
}
