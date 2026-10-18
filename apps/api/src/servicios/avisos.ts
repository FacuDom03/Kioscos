// Avisos automáticos del comercio (docs/API.md): qué datos lleva cada evento. Se arman dentro de
// la misma transacción que el cambio, y se mandan después de confirmarla.
import type { TxKiosco } from '@mostrador/db';
import type { EventoAviso } from '@mostrador/servidor';

export interface AvisoPendiente {
  evento: EventoAviso;
  datos: unknown;
}

/** De estos eventos, cuáles espera algún webhook activo del comercio. */
export async function eventosEsperados(
  tx: TxKiosco,
  eventos: readonly EventoAviso[],
): Promise<Set<EventoAviso>> {
  const filas = await tx
    .selectFrom('webhooks')
    .select('eventos')
    .where('activo', '=', true)
    .execute();
  return new Set(filas.flatMap((f) => f.eventos).filter((e) => eventos.includes(e)));
}

/** Una venta tal como la ven la API y los avisos (importes en centavos). */
export async function datosDeVenta(tx: TxKiosco, ventaId: string) {
  const v = await tx
    .selectFrom('ventas')
    .select(['id', 'creada_en_dispositivo', 'estado', 'total', 'anulada_en', 'motivo_anulacion'])
    .where('id', '=', ventaId)
    .executeTakeFirst();
  if (!v) return null;
  const [items, pagos] = await Promise.all([
    tx
      .selectFrom('venta_items')
      .select(['producto_id', 'descripcion', 'cantidad', 'precio_unitario', 'subtotal'])
      .where('venta_id', '=', ventaId)
      .orderBy('id')
      .execute(),
    tx
      .selectFrom('pagos')
      .select(['medio', 'monto', 'estado'])
      .where('venta_id', '=', ventaId)
      .orderBy('id')
      .execute(),
  ]);
  return {
    id: v.id,
    fecha: v.creada_en_dispositivo.toISOString(),
    estado: v.estado,
    total: v.total,
    ...(v.anulada_en
      ? { anuladaEn: v.anulada_en.toISOString(), motivoAnulacion: v.motivo_anulacion }
      : {}),
    items: items.map((i) => ({
      productoId: i.producto_id,
      descripcion: i.descripcion,
      cantidad: Number(i.cantidad),
      precioUnitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
    pagos: pagos.map((p) => ({ medio: p.medio, monto: p.monto, estado: p.estado })),
  };
}

/**
 * Productos que, con estas ventas, bajaron hasta su stock mínimo o menos. Solo los que recién
 * cruzaron el mínimo: si ya estaban por debajo, no se avisa otra vez en cada venta.
 */
export async function stockBajoTrasVentas(tx: TxKiosco, ventaIds: string[]) {
  if (!ventaIds.length) return [];
  const filas = await tx
    .selectFrom('venta_items as i')
    .innerJoin('productos as p', (j) =>
      j.onRef('p.id', '=', 'i.producto_id').onRef('p.kiosco_id', '=', 'i.kiosco_id'),
    )
    .select(['p.id', 'p.nombre', 'p.stock_actual', 'p.stock_minimo', 'i.cantidad'])
    .where('i.venta_id', 'in', ventaIds)
    .execute();
  const porProducto = new Map<
    string,
    { id: string; nombre: string; stock: number; minimo: number; vendido: number }
  >();
  for (const f of filas) {
    const p = porProducto.get(f.id) ?? {
      id: f.id,
      nombre: f.nombre,
      stock: Number(f.stock_actual),
      minimo: Number(f.stock_minimo),
      vendido: 0,
    };
    p.vendido += Number(f.cantidad);
    porProducto.set(f.id, p);
  }
  return [...porProducto.values()]
    .filter((p) => p.minimo > 0 && p.stock <= p.minimo && p.stock + p.vendido > p.minimo)
    .map(({ id, nombre, stock, minimo }) => ({ id, nombre, stock, minimo }));
}

/** Avisos de ventas recién registradas: venta.creada (si quedó cobrada) y stock.bajo. */
export async function avisosDeVentas(tx: TxKiosco, ventaIds: string[]): Promise<AvisoPendiente[]> {
  if (!ventaIds.length) return [];
  const esperados = await eventosEsperados(tx, ['venta.creada', 'stock.bajo']);
  if (!esperados.size) return [];
  // Las ventas con QR quedan esperando el pago: todavía no son ventas ni movieron stock.
  const cobradas = (
    await tx
      .selectFrom('ventas')
      .select('id')
      .where('id', 'in', ventaIds)
      .where('estado', '=', 'cobrada')
      .orderBy('id')
      .execute()
  ).map((v) => v.id);
  const avisos: AvisoPendiente[] = [];
  if (esperados.has('venta.creada')) {
    for (const id of cobradas) {
      const datos = await datosDeVenta(tx, id);
      if (datos) avisos.push({ evento: 'venta.creada', datos });
    }
  }
  if (esperados.has('stock.bajo')) {
    const productos = await stockBajoTrasVentas(tx, cobradas);
    if (productos.length) avisos.push({ evento: 'stock.bajo', datos: { productos } });
  }
  return avisos;
}
