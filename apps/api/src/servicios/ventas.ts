// Registro de ventas, gastos y aperturas de caja que llegan del equipo (con o sin conexión).
// Cada operación trae su UUID: reenviarla nunca duplica nada (sección 12 de docs/SPEC.md).
import type { TxKiosco } from '@mostrador/db';
import { formatearPlata, subtotal, uuidv7 } from '@mostrador/shared';
import {
  devolucionesDeCambio,
  descuentosDeVenta,
  esquemaCambio,
  esquemaDescuentos,
} from './promos.ts';
import { z } from 'zod';
import { ErrorPublico } from '../errores.ts';
import type { SesionCompleta } from './sesiones.ts';
import { moverStock } from './stock.ts';
import { clienteParaCuenta, saldoDe } from './clientes.ts';

const centavos = z.number().int().min(0).max(100_000_000_000);
const fecha = z.iso.datetime({ offset: true });

export const esquemaVenta = z.strictObject({
  id: z.uuid(),
  turnoId: z.uuid(),
  creadaEn: fecha,
  total: centavos,
  /** Lista de precios con la que se vendió (etapa I2). */
  lista: z.enum(['mostrador', 'gremio']).optional(),
  /** Presupuesto que se vende (etapa I4): queda cerrado con esta venta. */
  presupuestoId: z.uuid().optional(),
  /** Cliente al que se le anota lo que se paga a cuenta (etapa I5). */
  clienteId: z.uuid().optional(),
  /** Promos que aplicó el equipo (etapa I7). El servidor las vuelve a calcular. */
  descuentos: esquemaDescuentos.optional(),
  /** Para regalo: sale con ticket de cambio. */
  regalo: z.boolean().optional(),
  /** Cambio: lo que el cliente devuelve de una venta anterior se descuenta de esta. */
  cambio: esquemaCambio.optional(),
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        productoId: z.uuid().nullable(),
        descripcion: z.string().trim().min(1).max(120),
        cantidad: z.number().positive().max(100_000),
        precioUnitario: centavos,
      }),
    )
    .min(1)
    .max(300),
  pagos: z
    .array(
      z.strictObject({
        id: z.uuid(),
        // A cuenta (etapa I5): necesita clienteId; no es plata que entra a la caja.
        medio: z.enum(['efectivo', 'transferencia', 'cuenta_corriente']),
        monto: centavos.refine((n) => n > 0),
        recibido: centavos.optional(),
      }),
    )
    // Un cambio por algo del mismo precio no tiene pago.
    .max(5),
});
export type DatosVenta = z.infer<typeof esquemaVenta>;

export const esquemaGasto = z.strictObject({
  id: z.uuid(),
  turnoId: z.uuid(),
  tipo: z.enum(['gasto', 'retiro']),
  monto: centavos.refine((n) => n > 0),
  motivo: z.string().trim().min(1).max(200),
  creadoEn: fecha,
});

export const esquemaApertura = z.strictObject({
  id: z.uuid(),
  cambioInicial: centavos,
  abiertoEn: fecha,
});

export interface AvisoStock {
  productoId: string;
  nombre: string;
  stock: number;
}

export type ResultadoOp =
  | { estado: 'ok' | 'ya_existia'; avisos?: AvisoStock[]; turnoId?: string }
  | { estado: 'rechazada'; mensaje: string };

const rechazo = (mensaje: string): ResultadoOp => ({ estado: 'rechazada', mensaje });

export async function cajaDelKiosco(tx: TxKiosco): Promise<string> {
  const c = await tx.selectFrom('cajas').select('id').orderBy('created_at').executeTakeFirst();
  if (c) return c.id;
  throw new ErrorPublico(409, 'sin_caja', 'El kiosco no tiene caja. Avisanos por WhatsApp.');
}

export async function turnoAbierto(tx: TxKiosco) {
  return tx
    .selectFrom('turnos_caja')
    .selectAll()
    .where('cerrado_en', 'is', null)
    .orderBy('abierto_en', 'desc')
    .executeTakeFirst();
}

/**
 * Abre la caja. Si otro equipo ya la abrió, devuelve ese turno: el equipo pasa a vender en él
 * (V1: un turno compartido por kiosco).
 */
export async function registrarApertura(
  tx: TxKiosco,
  s: SesionCompleta,
  d: z.infer<typeof esquemaApertura>,
): Promise<ResultadoOp> {
  const existente = await tx
    .selectFrom('turnos_caja')
    .select('id')
    .where('id', '=', d.id)
    .executeTakeFirst();
  if (existente) return { estado: 'ya_existia', turnoId: d.id };
  const abierto = await turnoAbierto(tx);
  if (abierto) return { estado: 'ok', turnoId: abierto.id };
  const caja = await cajaDelKiosco(tx);
  await tx
    .insertInto('turnos_caja')
    .values({
      id: d.id,
      kiosco_id: s.kioscoId,
      caja_id: caja,
      abierto_por: s.usuarioId,
      abierto_en: d.abiertoEn,
      cambio_inicial: d.cambioInicial,
    })
    .execute();
  return { estado: 'ok', turnoId: d.id };
}

async function existeTurno(tx: TxKiosco, turnoId: string) {
  return !!(await tx
    .selectFrom('turnos_caja')
    .select('id')
    .where('id', '=', turnoId)
    .executeTakeFirst());
}

/** Venta, ítems, movimientos de stock y pagos en una sola transacción. */
export async function registrarVenta(
  tx: TxKiosco,
  s: SesionCompleta,
  v: DatosVenta,
): Promise<ResultadoOp> {
  const ya = await tx.selectFrom('ventas').select('id').where('id', '=', v.id).executeTakeFirst();
  if (ya) return { estado: 'ya_existia' };
  if (!(await existeTurno(tx, v.turnoId))) return rechazo('La caja de esta venta no existe.');

  const suma = v.items.reduce((t, i) => t + subtotal(i.cantidad, i.precioUnitario), 0);
  const descuentos = await descuentosDeVenta(tx, v.items, v.descuentos ?? [], v.creadaEn);
  if ('error' in descuentos) return rechazo(descuentos.error);
  const cambio = v.cambio ? await devolucionesDeCambio(tx, v.cambio) : null;
  if (cambio && 'error' in cambio) return rechazo(cambio.error);
  const devuelto = cambio?.total ?? 0;
  if (devuelto > suma - descuentos.total)
    return rechazo('Lo que se lleva tiene que valer lo mismo o más que lo que devuelve.');
  if (suma - descuentos.total - devuelto !== v.total)
    return rechazo('El total no coincide con los productos.');
  if (v.total > 0 && !v.pagos.length) return rechazo('Falta el pago.');
  const pagado = v.pagos.reduce((t, p) => t + p.monto, 0);
  if (pagado !== v.total) return rechazo('Los pagos no coinciden con el total.');
  for (const p of v.pagos) {
    if (p.medio === 'efectivo' && p.recibido !== undefined && p.recibido < p.monto)
      return rechazo('El efectivo recibido no alcanza.');
  }
  const ids = [...new Set(v.items.map((i) => i.productoId).filter((x): x is string => !!x))];
  if (ids.length) {
    const encontrados = await tx
      .selectFrom('productos')
      .select('id')
      .where('id', 'in', ids)
      .execute();
    if (encontrados.length !== ids.length) return rechazo('Un producto de la venta no existe.');
  }

  // A cuenta: el cliente tiene que existir y no pasarse del límite (se toma de a una operación).
  const aCuenta = v.pagos
    .filter((p) => p.medio === 'cuenta_corriente')
    .reduce((t, p) => t + p.monto, 0);
  if (aCuenta > 0) {
    if (!v.clienteId) return rechazo('Falta elegir a quién se le anota la venta.');
    const cliente = await clienteParaCuenta(tx, v.clienteId);
    if (!cliente?.activo) return rechazo('El cliente de la cuenta no existe.');
    const saldo = await saldoDe(tx, cliente.id);
    if (cliente.limite !== null && saldo + aCuenta > cliente.limite)
      return rechazo(
        `Con esta venta ${cliente.nombre} pasa su límite de ${formatearPlata(cliente.limite)} (debe ${formatearPlata(saldo)}).`,
      );
  }

  await tx
    .insertInto('ventas')
    .values({
      id: v.id,
      kiosco_id: s.kioscoId,
      turno_id: v.turnoId,
      usuario_id: s.usuarioId,
      dispositivo_id: s.dispositivoId,
      total: v.total,
      estado: 'cobrada',
      lista: v.lista ?? 'mostrador',
      cliente_id: aCuenta > 0 ? (v.clienteId ?? null) : null,
      regalo: v.regalo ?? false,
      creada_en_dispositivo: v.creadaEn,
    })
    .execute();
  const avisos: AvisoStock[] = [];
  for (const i of v.items) {
    await tx
      .insertInto('venta_items')
      .values({
        id: i.id,
        kiosco_id: s.kioscoId,
        venta_id: v.id,
        producto_id: i.productoId,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precio_unitario: i.precioUnitario,
        subtotal: subtotal(i.cantidad, i.precioUnitario),
      })
      .execute();
    if (i.productoId) {
      // El stock puede quedar negativo: se avisa, pero no se frena la venta.
      const { stockNuevo } = await moverStock(tx, {
        kioscoId: s.kioscoId,
        productoId: i.productoId,
        tipo: 'venta',
        cantidad: -i.cantidad,
        usuarioId: s.usuarioId,
        ventaId: v.id,
      });
      if (stockNuevo < 0)
        avisos.push({ productoId: i.productoId, nombre: i.descripcion, stock: stockNuevo });
    }
  }
  for (const d of descuentos.filas) {
    await tx
      .insertInto('venta_descuentos')
      .values({ id: uuidv7(), kiosco_id: s.kioscoId, venta_id: v.id, ...d })
      .execute();
  }
  for (const d of cambio?.filas ?? []) {
    await tx
      .insertInto('devoluciones')
      .values({ id: uuidv7(), kiosco_id: s.kioscoId, venta_id: v.id, ...d })
      .execute();
    if (d.producto_id)
      await moverStock(tx, {
        kioscoId: s.kioscoId,
        productoId: d.producto_id,
        tipo: 'devolucion',
        cantidad: d.cantidad,
        usuarioId: s.usuarioId,
        ventaId: v.id,
        motivo: 'Cambio',
      });
  }
  if (v.presupuestoId) {
    // Si ya se vendió o se anuló, la venta igual se guarda.
    await tx
      .updateTable('presupuestos')
      .set({ estado: 'vendido', venta_id: v.id, updated_at: new Date() })
      .where('id', '=', v.presupuestoId)
      .where('estado', '=', 'abierto')
      .execute();
  }
  for (const p of v.pagos) {
    await tx
      .insertInto('pagos')
      .values({
        id: p.id,
        kiosco_id: s.kioscoId,
        venta_id: v.id,
        medio: p.medio,
        monto: p.monto,
        recibido: p.medio === 'efectivo' ? (p.recibido ?? p.monto) : null,
        vuelto: p.medio === 'efectivo' ? (p.recibido ?? p.monto) - p.monto : null,
        estado: 'aprobado',
        confirmado_en: v.creadaEn,
      })
      .execute();
  }
  if (aCuenta > 0 && v.clienteId) {
    await tx
      .insertInto('movimientos_cuenta')
      .values({
        id: uuidv7(),
        kiosco_id: s.kioscoId,
        cliente_id: v.clienteId,
        tipo: 'venta',
        monto: aCuenta,
        venta_id: v.id,
        usuario_id: s.usuarioId,
      })
      .execute();
  }
  return avisos.length ? { estado: 'ok', avisos } : { estado: 'ok' };
}

export async function registrarGasto(
  tx: TxKiosco,
  s: SesionCompleta,
  g: z.infer<typeof esquemaGasto>,
): Promise<ResultadoOp> {
  const ya = await tx.selectFrom('gastos').select('id').where('id', '=', g.id).executeTakeFirst();
  if (ya) return { estado: 'ya_existia' };
  if (!(await existeTurno(tx, g.turnoId))) return rechazo('La caja de este gasto no existe.');
  await tx
    .insertInto('gastos')
    .values({
      id: g.id,
      kiosco_id: s.kioscoId,
      turno_id: g.turnoId,
      usuario_id: s.usuarioId,
      tipo: g.tipo,
      monto: g.monto,
      motivo: g.motivo,
      creado_en_dispositivo: g.creadoEn,
    })
    .execute();
  return { estado: 'ok' };
}

export interface Resumen {
  vendido: number;
  ventas: number;
  porMedio: { efectivo: number; qr_mp: number; transferencia: number; cuenta_corriente: number };
  /** Pagos de cuentas corrientes que entraron en el turno (el efectivo va a la caja). */
  cobrosCuenta: { efectivo: number; transferencia: number };
  gastos: number;
  retiros: number;
  deberiaHaber: number;
}

/** Totales del turno. Las ventas anuladas no cuentan. */
export async function resumenTurno(
  tx: TxKiosco,
  turnoId: string,
  cambioInicial: number,
): Promise<Resumen> {
  const pagos = await tx
    .selectFrom('pagos as p')
    .innerJoin('ventas as v', (j) =>
      j.onRef('v.id', '=', 'p.venta_id').onRef('v.kiosco_id', '=', 'p.kiosco_id'),
    )
    .select(['p.medio'])
    .select((eb) => eb.fn.sum<string>('p.monto').as('total'))
    .where('v.turno_id', '=', turnoId)
    .where('v.estado', '=', 'cobrada')
    .where('p.estado', '=', 'aprobado')
    .groupBy('p.medio')
    .execute();
  const ventas = await tx
    .selectFrom('ventas')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('turno_id', '=', turnoId)
    .where('estado', '=', 'cobrada')
    .executeTakeFirstOrThrow();
  const gastos = await tx
    .selectFrom('gastos')
    .select(['tipo'])
    .select((eb) => eb.fn.sum<string>('monto').as('total'))
    .where('turno_id', '=', turnoId)
    .groupBy('tipo')
    .execute();
  const cobros = await tx
    .selectFrom('movimientos_cuenta')
    .select(['medio'])
    .select((eb) => eb.fn.sum<string>('monto').as('total'))
    .where('turno_id', '=', turnoId)
    .where('tipo', '=', 'pago')
    .groupBy('medio')
    .execute();
  const cobrosCuenta = { efectivo: 0, transferencia: 0 };
  for (const c of cobros) if (c.medio) cobrosCuenta[c.medio] = -Number(c.total);
  const porMedio = { efectivo: 0, qr_mp: 0, transferencia: 0, cuenta_corriente: 0 };
  for (const p of pagos) porMedio[p.medio] = Number(p.total);
  const g = Number(gastos.find((x) => x.tipo === 'gasto')?.total ?? 0);
  const r = Number(gastos.find((x) => x.tipo === 'retiro')?.total ?? 0);
  return {
    vendido:
      porMedio.efectivo + porMedio.qr_mp + porMedio.transferencia + porMedio.cuenta_corriente,
    ventas: Number(ventas.n),
    porMedio,
    cobrosCuenta,
    gastos: g,
    retiros: r,
    deberiaHaber: cambioInicial + porMedio.efectivo + cobrosCuenta.efectivo - g - r,
  };
}
