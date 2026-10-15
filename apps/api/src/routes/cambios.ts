// Cambios (etapa I7): buscar la venta de lo que el cliente trae, por el código del ticket de
// cambio o por el producto. El cambio en sí es una venta con lo devuelto (servicios/ventas.ts).
import { sql } from '@mostrador/db';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico } from '../errores.ts';
import { devueltoPorItem } from '../servicios/promos.ts';
import { validar } from '../validar.ts';

const VENDEN = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const DIAS = 90;

export async function rutasCambios(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/cambios/ventas', { config: { roles: VENDEN } }, async (req) => {
    const d = validar(
      z.strictObject({
        // Los últimos 8 caracteres del ID de la venta, impresos en el ticket de cambio.
        codigo: z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F]{8}$/)
          .optional(),
        productoId: z.uuid().optional(),
      }),
      req.query,
    );
    if (!d.codigo === !d.productoId)
      throw new ErrorPublico(400, 'datos_invalidos', 'Buscá por código o por producto.');
    return req.db(async (tx) => {
      let q = tx
        .selectFrom('ventas as v')
        .select(['v.id', 'v.total', 'v.regalo', 'v.creada_en_dispositivo'])
        .where('v.estado', '=', 'cobrada')
        .where('v.creada_en_dispositivo', '>=', new Date(Date.now() - DIAS * 24 * 3600_000))
        .orderBy('v.creada_en_dispositivo', 'desc')
        .limit(10);
      if (d.codigo)
        q = q.where(sql`right(${sql.ref('v.id')}::text, 8)`, '=', d.codigo.toLowerCase());
      if (d.productoId) {
        const productoId = d.productoId;
        q = q.where(({ exists, selectFrom }) =>
          exists(
            selectFrom('venta_items as i')
              .select(sql`1`.as('x'))
              .whereRef('i.venta_id', '=', 'v.id')
              .whereRef('i.kiosco_id', '=', 'v.kiosco_id')
              .where('i.producto_id', '=', productoId),
          ),
        );
      }
      const ventas = await q.execute();
      const resultado = [];
      for (const v of ventas) {
        const items = await tx
          .selectFrom('venta_items as i')
          .leftJoin('productos as p', (j) =>
            j.onRef('p.id', '=', 'i.producto_id').onRef('p.kiosco_id', '=', 'i.kiosco_id'),
          )
          .select([
            'i.id',
            'i.producto_id',
            'i.descripcion',
            'i.cantidad',
            'i.precio_unitario',
            'i.subtotal',
            'p.unidad',
          ])
          .where('i.venta_id', '=', v.id)
          .orderBy('i.id')
          .execute();
        const desc = await tx
          .selectFrom('venta_descuentos')
          .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('monto'), sql<string>`0`).as('total'))
          .where('venta_id', '=', v.id)
          .executeTakeFirstOrThrow();
        const devuelto = await devueltoPorItem(tx, v.id);
        resultado.push({
          id: v.id,
          codigo: v.id.slice(-8).toUpperCase(),
          creadaEn: v.creada_en_dispositivo,
          total: v.total,
          regalo: v.regalo,
          suma: items.reduce((t, i) => t + i.subtotal, 0),
          descuentos: Number(desc.total),
          items: items.map((i) => ({
            id: i.id,
            productoId: i.producto_id,
            descripcion: i.descripcion,
            cantidad: Number(i.cantidad),
            unidad: i.unidad ?? 'unidad',
            precioUnitario: i.precio_unitario,
            subtotal: i.subtotal,
            devuelto: devuelto.get(i.id) ?? 0,
          })),
        });
      }
      return { dias: DIAS, ventas: resultado };
    });
  });
}
