// Carga de compras: ingreso de mercadería con costo. Opcionalmente actualiza el precio de venta.
import type { FastifyInstance } from 'fastify';
import { precioConMargen, uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { noEncontrado } from '../errores.ts';
import { moverStock } from '../servicios/stock.ts';
import { validar } from '../validar.ts';

const ROLES = ['dueno', 'encargado', 'soporte'] as const;

export async function rutasCompras(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/compras', { config: { roles: ROLES } }, async (req) => {
    const d = validar(
      z.strictObject({
        nota: z.string().trim().max(500).optional(),
        items: z
          .array(
            z.strictObject({
              productoId: z.uuid(),
              cantidad: z.number().positive().max(1_000_000),
              costoUnitario: z.number().int().min(0).max(100_000_000_000),
              // Precio de venta nuevo: fijo o calculado con un margen sobre el costo.
              precioNuevo: z.number().int().min(0).max(100_000_000_000).optional(),
              margen: z.number().min(0).max(1000).optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
      req.body,
    );
    const id = uuidv7();
    const s = req.completa;
    await req.db(async (tx) => {
      const ids = [...new Set(d.items.map((i) => i.productoId))];
      const encontrados = await tx
        .selectFrom('productos')
        .select('id')
        .where('id', 'in', ids)
        .execute();
      if (encontrados.length !== ids.length) throw noEncontrado();
      const total = d.items.reduce((t, i) => t + Math.round(i.cantidad * i.costoUnitario), 0);
      await tx
        .insertInto('compras')
        .values({ id, kiosco_id: s.kioscoId, usuario_id: s.usuarioId, total, nota: d.nota ?? null })
        .execute();
      for (const i of d.items) {
        const subtotal = Math.round(i.cantidad * i.costoUnitario);
        await tx
          .insertInto('compra_items')
          .values({
            id: uuidv7(),
            kiosco_id: s.kioscoId,
            compra_id: id,
            producto_id: i.productoId,
            cantidad: i.cantidad,
            costo_unitario: i.costoUnitario,
            subtotal,
          })
          .execute();
        await moverStock(tx, {
          kioscoId: s.kioscoId,
          productoId: i.productoId,
          tipo: 'compra',
          cantidad: i.cantidad,
          usuarioId: s.usuarioId,
          costoUnitario: i.costoUnitario,
          compraId: id,
        });
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
      }
    });
    return { id };
  });

  app.get('/api/v1/compras', { config: { roles: ROLES } }, async (req) =>
    req.db(async (tx) => {
      const compras = await tx
        .selectFrom('compras as c')
        .leftJoin('usuarios as u', 'u.id', 'c.usuario_id')
        .select(['c.id', 'c.total', 'c.nota', 'c.created_at', 'u.nombre'])
        .orderBy('c.created_at', 'desc')
        .limit(50)
        .execute();
      return compras;
    }),
  );
}
