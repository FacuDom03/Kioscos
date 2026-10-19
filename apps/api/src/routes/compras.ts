// Compras como factura de compra: proveedor, comprobante y fecha; renglones con producto (que
// suman stock o no) o sin producto (flete, bolsas). Opcionalmente actualiza el precio de venta.
import type { FastifyInstance } from 'fastify';
import {
  diaArgentino,
  normalizarNumeroComprobante,
  precioConMargen,
  uuidv7,
} from '@mostrador/shared';
import { z } from 'zod';
import { datosInvalidos, ErrorPublico, noEncontrado } from '../errores.ts';
import { eventosEsperados, type AvisoPendiente } from '../servicios/avisos.ts';
import { moverStock } from '../servicios/stock.ts';
import { validar } from '../validar.ts';

const ROLES = ['dueno', 'encargado', 'soporte'] as const;

const COMPROBANTES = ['factura_a', 'factura_b', 'factura_c', 'remito', 'ticket', 'otro'] as const;
const CON_NUMERO_ARCA = new Set(['factura_a', 'factura_b', 'factura_c', 'remito']);

const esquemaCompra = z.strictObject({
  nota: z.string().trim().max(500).optional(),
  proveedorId: z.uuid().optional(),
  comprobante: z.enum(COMPROBANTES).optional(),
  numero: z.string().trim().min(1).max(30).optional(),
  /** Fecha de la factura. Si falta, hoy. */
  fecha: z.iso.date().optional(),
  items: z
    .array(
      z
        .strictObject({
          productoId: z.uuid().optional(),
          /** Renglón sin producto: flete, bolsas, un servicio. No mueve stock. */
          descripcion: z.string().trim().min(1).max(120).optional(),
          cantidad: z.number().positive().max(1_000_000),
          costoUnitario: z.number().int().min(0).max(100_000_000_000),
          // Precio de venta nuevo: fijo o calculado con un margen sobre el costo.
          precioNuevo: z.number().int().min(0).max(100_000_000_000).optional(),
          margen: z.number().min(0).max(1000).optional(),
          /** Si la mercadería ya entró (por ejemplo, con el remito), no se suma otra vez. */
          sumaStock: z.boolean().default(true),
        })
        .refine((i) => (i.productoId ? !i.descripcion : !!i.descripcion))
        .refine((i) => i.productoId || (i.precioNuevo === undefined && i.margen === undefined)),
    )
    .min(1)
    .max(500),
});

export async function rutasCompras(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/compras', { config: { roles: ROLES } }, async (req) => {
    const d = validar(esquemaCompra, req.body);
    if (d.numero && !d.comprobante) throw datosInvalidos('Elegí el tipo de comprobante.');
    // Facturas y remitos llevan punto de venta y número: "0003-00001234".
    const numero =
      d.numero && d.comprobante && CON_NUMERO_ARCA.has(d.comprobante)
        ? normalizarNumeroComprobante(d.numero)
        : (d.numero ?? null);
    if (d.numero && !numero)
      throw datosInvalidos(
        'El número tiene que tener punto de venta y número, como 0003-00001234.',
      );
    const hoy = diaArgentino();
    if (d.fecha && d.fecha > hoy)
      throw datosInvalidos('La fecha de la factura no puede ser futura.');
    const id = uuidv7();
    const s = req.completa;
    const avisos = await req.db(async (tx) => {
      if (d.proveedorId) {
        const p = await tx
          .selectFrom('proveedores')
          .select('id')
          .where('id', '=', d.proveedorId)
          .executeTakeFirst();
        if (!p) throw noEncontrado();
        if (numero && d.comprobante) {
          const repetida = await tx
            .selectFrom('compras')
            .select('created_at')
            .where('proveedor_id', '=', d.proveedorId)
            .where('comprobante', '=', d.comprobante)
            .where('numero', '=', numero)
            .executeTakeFirst();
          if (repetida)
            throw new ErrorPublico(
              409,
              'compra_repetida',
              `Esa factura de ese proveedor ya está cargada (el ${repetida.created_at.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}).`,
            );
        }
      }
      const ids = [...new Set(d.items.flatMap((i) => (i.productoId ? [i.productoId] : [])))];
      if (ids.length) {
        const encontrados = await tx
          .selectFrom('productos')
          .select('id')
          .where('id', 'in', ids)
          .execute();
        if (encontrados.length !== ids.length) throw noEncontrado();
      }
      const total = d.items.reduce((t, i) => t + Math.round(i.cantidad * i.costoUnitario), 0);
      await tx
        .insertInto('compras')
        .values({
          id,
          kiosco_id: s.kioscoId,
          usuario_id: s.usuarioId,
          total,
          nota: d.nota ?? null,
          proveedor_id: d.proveedorId ?? null,
          comprobante: d.comprobante ?? null,
          numero,
          fecha: d.fecha ?? hoy,
        })
        .execute();
      for (const i of d.items) {
        const subtotal = Math.round(i.cantidad * i.costoUnitario);
        const sumaStock = !!i.productoId && i.sumaStock;
        await tx
          .insertInto('compra_items')
          .values({
            id: uuidv7(),
            kiosco_id: s.kioscoId,
            compra_id: id,
            producto_id: i.productoId ?? null,
            descripcion: i.productoId ? null : (i.descripcion ?? null),
            suma_stock: sumaStock,
            cantidad: i.cantidad,
            costo_unitario: i.costoUnitario,
            subtotal,
          })
          .execute();
        if (!i.productoId) continue;
        if (sumaStock)
          await moverStock(tx, {
            kioscoId: s.kioscoId,
            productoId: i.productoId,
            tipo: 'compra',
            cantidad: i.cantidad,
            usuarioId: s.usuarioId,
            costoUnitario: i.costoUnitario,
            compraId: id,
          });
        // El costo se actualiza siempre: la factura confirma lo que se pagó.
        const precio =
          i.precioNuevo ??
          (i.margen !== undefined ? precioConMargen(i.costoUnitario, i.margen) : undefined);
        await tx
          .updateTable('productos')
          .set({
            costo: i.costoUnitario,
            ...(precio !== undefined ? { precio } : {}),
            updated_at: new Date(),
          })
          .where('id', '=', i.productoId)
          .execute();
        if (d.proveedorId)
          await tx
            .updateTable('producto_proveedor')
            .set({ costo: i.costoUnitario, actualizado_en: new Date() })
            .where('proveedor_id', '=', d.proveedorId)
            .where('producto_id', '=', i.productoId)
            .execute();
      }
      const avisos: AvisoPendiente[] = [];
      if ((await eventosEsperados(tx, ['compra.creada'])).size)
        avisos.push({
          evento: 'compra.creada',
          datos: {
            id,
            fecha: d.fecha ?? hoy,
            proveedorId: d.proveedorId ?? null,
            comprobante: d.comprobante ?? null,
            numero,
            total,
            nota: d.nota ?? null,
            items: d.items.map((i) => ({
              productoId: i.productoId ?? null,
              descripcion: i.productoId ? null : (i.descripcion ?? null),
              cantidad: i.cantidad,
              costoUnitario: i.costoUnitario,
              subtotal: Math.round(i.cantidad * i.costoUnitario),
              sumaStock: !!i.productoId && i.sumaStock,
            })),
          },
        });
      return avisos;
    });
    await app.avisar(s.kioscoId, avisos);
    return { id };
  });

  app.get('/api/v1/compras', { config: { roles: ROLES } }, async (req) => {
    const { desde, hasta } = validar(
      z.strictObject({ desde: z.iso.date().optional(), hasta: z.iso.date().optional() }),
      req.query,
    );
    return req.db(async (tx) => {
      let q = tx
        .selectFrom('compras as c')
        .leftJoin('usuarios as u', 'u.id', 'c.usuario_id')
        .leftJoin('proveedores as pr', (j) =>
          j.onRef('pr.id', '=', 'c.proveedor_id').onRef('pr.kiosco_id', '=', 'c.kiosco_id'),
        )
        .select([
          'c.id',
          'c.total',
          'c.nota',
          'c.created_at',
          'c.comprobante',
          'c.numero',
          'c.fecha',
          'u.nombre',
          'pr.nombre as proveedor',
        ])
        .select((eb) =>
          eb
            .selectFrom('compra_items as i')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('i.compra_id', '=', 'c.id')
            .as('productos'),
        )
        .orderBy('c.created_at', 'desc')
        .limit(200);
      if (desde) q = q.where('c.created_at', '>=', new Date(`${desde}T00:00:00-03:00`));
      if (hasta)
        q = q.where(
          'c.created_at',
          '<',
          new Date(new Date(`${hasta}T00:00:00-03:00`).getTime() + 86_400_000),
        );
      const compras = await q.execute();
      return compras.map((c) => ({ ...c, productos: Number(c.productos ?? 0) }));
    });
  });

  // Detalle de una compra: qué llegó, cuánto y a qué costo.
  app.get('/api/v1/compras/:id', { config: { roles: ROLES } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    return req.db(async (tx) => {
      const c = await tx
        .selectFrom('compras as c')
        .leftJoin('usuarios as u', 'u.id', 'c.usuario_id')
        .leftJoin('proveedores as pr', (j) =>
          j.onRef('pr.id', '=', 'c.proveedor_id').onRef('pr.kiosco_id', '=', 'c.kiosco_id'),
        )
        .select([
          'c.id',
          'c.total',
          'c.nota',
          'c.created_at',
          'c.comprobante',
          'c.numero',
          'c.fecha',
          'u.nombre',
          'pr.nombre as proveedor',
        ])
        .where('c.id', '=', id)
        .executeTakeFirst();
      if (!c) throw noEncontrado();
      const items = await tx
        .selectFrom('compra_items as i')
        .leftJoin('productos as p', 'p.id', 'i.producto_id')
        .select([
          'i.id',
          'i.producto_id',
          'p.nombre',
          'p.unidad',
          'i.descripcion',
          'i.suma_stock',
          'i.cantidad',
          'i.costo_unitario',
          'i.subtotal',
        ])
        .where('i.compra_id', '=', id)
        .orderBy('i.id')
        .execute();
      return { ...c, items: items.map((i) => ({ ...i, cantidad: Number(i.cantidad) })) };
    });
  });
}
