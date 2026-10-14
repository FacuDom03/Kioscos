import { sinKiosco, sql, withKiosco, type BaseApp } from '@mostrador/db';
import type { Cifrador } from '@mostrador/servidor';
import type { ClienteMp } from './cliente.ts';
import { aplicarOrden, integracionDelKiosco, type ResultadoOrden } from './cobros.ts';

/**
 * Reconsulta una orden en la API de Mercado Pago con el token del vendedor del kiosco que la
 * creó y aplica su estado. Es lo que dispara un webhook (verificado) y lo que hace el worker.
 */
export async function reconsultarOrden(
  base: BaseApp,
  cifrador: Cifrador,
  cliente: ClienteMp,
  ordenId: string,
): Promise<ResultadoOrden> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{
      kiosco_id: string;
      pago_id: string;
    }>`select * from mp_pago_por_orden(${ordenId})`.execute(tx),
  );
  const fila = rows[0];
  if (!fila) return 'ignorada';
  return reconsultarPago(base, cifrador, cliente, fila.kiosco_id, fila.pago_id);
}

export async function reconsultarPago(
  base: BaseApp,
  cifrador: Cifrador,
  cliente: ClienteMp,
  kioscoId: string,
  pagoId: string,
): Promise<ResultadoOrden> {
  const datos = await withKiosco(base, kioscoId, async (tx) => {
    const integ = await integracionDelKiosco(tx, cifrador);
    const pago = await tx
      .selectFrom('pagos')
      .select(['mp_order_id'])
      .where('id', '=', pagoId)
      .executeTakeFirst();
    return integ && pago?.mp_order_id ? { integ, orden: pago.mp_order_id } : null;
  });
  if (!datos) return 'ignorada';
  const orden = await cliente.obtenerOrden(datos.integ.accessToken, datos.orden);
  return withKiosco(base, kioscoId, (tx) => aplicarOrden(tx, pagoId, orden, datos.integ.mpUserId));
}

/** Pagos QR pendientes de todos los kioscos (para el worker). */
export async function pagosPendientes(
  base: BaseApp,
): Promise<{ kiosco_id: string; pago_id: string }[]> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{ kiosco_id: string; pago_id: string }>`select * from mp_pagos_pendientes()`.execute(tx),
  );
  return rows;
}

/**
 * Renueva los tokens que vencen en menos de 30 días. Si el vendedor revocó el acceso, la
 * integración pasa a "requiere atención" y queda en la auditoría para avisar al dueño.
 */
export async function renovarTokens(
  base: BaseApp,
  cifrador: Cifrador,
  cliente: ClienteMp,
): Promise<{ renovados: number; fallidos: number }> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{ kiosco_id: string }>`select * from mp_integraciones_a_renovar()`.execute(tx),
  );
  let renovados = 0;
  let fallidos = 0;
  for (const { kiosco_id } of rows) {
    const integ = await withKiosco(base, kiosco_id, (tx) => integracionDelKiosco(tx, cifrador));
    if (!integ?.refreshToken) continue;
    try {
      const t = await cliente.renovar(integ.refreshToken);
      const a = cifrador.cifrar(t.access_token);
      const r = cifrador.cifrar(t.refresh_token);
      await withKiosco(base, kiosco_id, (tx) =>
        tx
          .updateTable('integraciones')
          .set({
            access_token_cifrado: a.datos,
            refresh_token_cifrado: r.datos,
            clave_version: a.version,
            vence_en: new Date(Date.now() + t.expires_in * 1000),
            estado: 'conectado',
            updated_at: new Date(),
          })
          .where('id', '=', integ.id)
          .execute(),
      );
      renovados++;
    } catch {
      fallidos++;
      await withKiosco(base, kiosco_id, async (tx) => {
        await tx
          .updateTable('integraciones')
          .set({ estado: 'requiere_atencion', updated_at: new Date() })
          .where('id', '=', integ.id)
          .execute();
        await tx
          .insertInto('auditoria')
          .values({
            id: crypto.randomUUID(),
            kiosco_id,
            accion: 'mp.requiere_atencion',
            detalle: JSON.stringify({ motivo: 'No se pudo renovar el acceso' }),
          })
          .execute();
      });
    }
  }
  return { renovados, fallidos };
}
