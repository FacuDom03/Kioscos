// Promos y cambios de una venta (etapa I7). El equipo arma el ticket con la misma cuenta de
// @mostrador/shared; acá se vuelve a hacer con lo que hay en la base antes de guardar nada.
import { sql, type TxKiosco } from '@mostrador/db';
import { calcularPromos, diaArgentino, importeDeDevolucion } from '@mostrador/shared';
import { z } from 'zod';

const centavos = z.number().int().min(0).max(100_000_000_000);

export const esquemaDescuentos = z
  .array(z.strictObject({ promoId: z.uuid(), monto: centavos.refine((n) => n > 0) }))
  .max(20);

export const esquemaCambio = z.strictObject({
  ventaId: z.uuid(),
  items: z
    .array(z.strictObject({ itemId: z.uuid(), cantidad: z.number().positive().max(100_000) }))
    .min(1)
    .max(100),
});

interface ItemVendido {
  productoId: string | null;
  cantidad: number;
  precioUnitario: number;
}

type Resultado<T> = T | { error: string };

/**
 * Valida lo que descontó cada promo: tiene que existir y no descontar más de lo que da su regla
 * con los productos de la venta, el día de la venta. Devuelve las filas para `venta_descuentos`.
 *
 * Una venta hecha sin conexión puede llegar después de que el dueño cambió la categoría o el
 * grupo de un producto: entonces la cuenta de hoy no coincide. En ese caso se acepta si no pasa
 * de lo que daría la regla con todos los productos de la venta adentro, y se marca para revisar
 * (queda en la actividad): rechazarla dejaría una venta cobrada sin registrar.
 */
export async function descuentosDeVenta(
  tx: TxKiosco,
  items: ItemVendido[],
  pedidos: z.infer<typeof esquemaDescuentos>,
  creadaEn: string,
): Promise<
  Resultado<{
    filas: { promo_id: string; descripcion: string; monto: number }[];
    total: number;
    /** Promos aceptadas sin que la cuenta de hoy coincida. */
    revisar: string[];
  }>
> {
  if (!pedidos.length) return { filas: [], total: 0, revisar: [] };
  const ids = [...new Set(pedidos.map((d) => d.promoId))];
  if (ids.length !== pedidos.length) return { error: 'Una promo está dos veces.' };
  const promos = await tx.selectFrom('promos').selectAll().where('id', 'in', ids).execute();
  if (promos.length !== ids.length) return { error: 'Una promo de la venta no existe.' };
  const productos = [...new Set(items.map((i) => i.productoId).filter((x): x is string => !!x))];
  const datos = productos.length
    ? await tx
        .selectFrom('productos')
        .select(['id', 'categoria_id', 'grupo_id'])
        .where('id', 'in', productos)
        .execute()
    : [];
  const porId = new Map(datos.map((p) => [p.id, p]));
  const reglas = promos.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    lleva: p.lleva,
    paga: p.paga,
    descuento: p.descuento,
    categoriaId: p.categoria_id,
    grupoId: p.grupo_id,
    desde: p.desde,
    hasta: p.hasta,
  }));
  const dia = diaArgentino(creadaEn);
  const calculados = calcularPromos(
    items.map((i) => {
      const p = i.productoId ? porId.get(i.productoId) : undefined;
      return {
        productoId: i.productoId,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        categoriaId: p?.categoria_id ?? null,
        grupoId: p?.grupo_id ?? null,
      };
    }),
    reglas,
    dia,
  );
  const filas = [];
  const revisar: string[] = [];
  for (const d of pedidos) {
    const c = calculados.find((x) => x.promoId === d.promoId);
    if (c && d.monto <= c.monto) {
      filas.push({ promo_id: d.promoId, descripcion: c.descripcion, monto: d.monto });
      continue;
    }
    // Tope: la misma regla con todos los productos de la venta adentro.
    const regla = reglas.find((r) => r.id === d.promoId);
    const tope = regla
      ? calcularPromos(
          items.map((i) => ({
            productoId: i.productoId,
            cantidad: i.cantidad,
            precioUnitario: i.precioUnitario,
            categoriaId: regla.categoriaId,
            grupoId: regla.grupoId,
          })),
          [regla],
          dia,
        )[0]
      : undefined;
    if (!regla || !tope || d.monto > tope.monto)
      return { error: 'La promo no coincide con los productos.' };
    filas.push({ promo_id: d.promoId, descripcion: regla.nombre, monto: d.monto });
    revisar.push(d.promoId);
  }
  return { filas, total: filas.reduce((t, f) => t + f.monto, 0), revisar };
}

/** Lo que ya se devolvió de cada ítem en cambios que no se anularon. */
export async function devueltoPorItem(tx: TxKiosco, ventaId: string): Promise<Map<string, number>> {
  const filas = await tx
    .selectFrom('devoluciones as d')
    .innerJoin('ventas as v', (j) =>
      j.onRef('v.id', '=', 'd.venta_id').onRef('v.kiosco_id', '=', 'd.kiosco_id'),
    )
    .innerJoin('venta_items as i', (j) =>
      j.onRef('i.id', '=', 'd.venta_item_id').onRef('i.kiosco_id', '=', 'd.kiosco_id'),
    )
    .select(['d.venta_item_id'])
    .select(sql<string>`sum(d.cantidad)`.as('cantidad'))
    .where('i.venta_id', '=', ventaId)
    .where('v.estado', '<>', 'anulada')
    .groupBy('d.venta_item_id')
    .execute();
  return new Map(filas.map((f) => [f.venta_item_id, Number(f.cantidad)]));
}

/**
 * Valida lo que el cliente devuelve: ítems de una venta cobrada, sin pasarse de lo que se llevó
 * (contando cambios anteriores). El importe es lo que pagó por eso.
 */
export async function devolucionesDeCambio(
  tx: TxKiosco,
  cambio: z.infer<typeof esquemaCambio>,
  /** Hasta cuántos días después de la venta se acepta el cambio. */
  dias: number,
): Promise<
  Resultado<{
    filas: {
      venta_item_id: string;
      producto_id: string | null;
      descripcion: string;
      cantidad: number;
      importe: number;
    }[];
    total: number;
  }>
> {
  // Se bloquea la venta original: dos cambios a la vez no devuelven dos veces lo mismo.
  const original = await tx
    .selectFrom('ventas')
    .select(['id', 'estado', 'creada_en_dispositivo'])
    .where('id', '=', cambio.ventaId)
    .forUpdate()
    .executeTakeFirst();
  if (original?.estado !== 'cobrada') return { error: 'La venta del cambio no existe.' };
  if (Date.now() - original.creada_en_dispositivo.getTime() > dias * 24 * 3600_000)
    return {
      error: `Esa venta es de hace más de ${dias} días.${dias < 90 ? ' El cambio lo puede hacer el dueño o el encargado.' : ''}`,
    };
  const items = await tx
    .selectFrom('venta_items')
    .select(['id', 'producto_id', 'descripcion', 'cantidad', 'subtotal'])
    .where('venta_id', '=', cambio.ventaId)
    .execute();
  const desc = await tx
    .selectFrom('venta_descuentos')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('monto'), sql<string>`0`).as('total'))
    .where('venta_id', '=', cambio.ventaId)
    .executeTakeFirstOrThrow();
  const venta = {
    suma: items.reduce((t, i) => t + i.subtotal, 0),
    descuentos: Number(desc.total),
  };
  const yaDevuelto = await devueltoPorItem(tx, cambio.ventaId);
  if (new Set(cambio.items.map((x) => x.itemId)).size !== cambio.items.length)
    return { error: 'Un producto del cambio está dos veces.' };
  const filas = [];
  for (const x of cambio.items) {
    const item = items.find((i) => i.id === x.itemId);
    if (!item) return { error: 'Lo que se devuelve no es de esa venta.' };
    const cantidad = Number(item.cantidad);
    const ya = yaDevuelto.get(item.id) ?? 0;
    const queda = Math.round((cantidad - ya) * 1000) / 1000;
    if (x.cantidad > queda)
      return {
        error:
          queda > 0
            ? `De ${item.descripcion} quedan ${queda} para cambiar.`
            : `${item.descripcion} ya se cambió.`,
      };
    filas.push({
      venta_item_id: item.id,
      producto_id: item.producto_id,
      descripcion: item.descripcion,
      cantidad: x.cantidad,
      importe: importeDeDevolucion({ cantidad, subtotal: item.subtotal }, ya, x.cantidad, venta),
    });
  }
  return { filas, total: filas.reduce((t, f) => t + f.importe, 0) };
}
