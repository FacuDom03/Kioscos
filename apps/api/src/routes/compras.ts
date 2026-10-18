// Carga de compras: ingreso de mercadería con costo. Opcionalmente actualiza el precio de venta.
import type { FastifyInstance } from 'fastify';
import { precioConMargen, uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { noEncontrado } from '../errores.ts';
import { eventosEsperados, type AvisoPendiente } from '../servicios/avisos.ts';
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
    const avisos = await req.db(async (tx) => {
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
      const avisos: AvisoPendiente[] = [];
      if ((await eventosEsperados(tx, ['compra.creada'])).size)
        avisos.push({
          evento: 'compra.creada',
          datos: {
            id,
            fecha: new Date().toISOString(),
            total,
            nota: d.nota ?? null,
            items: d.items.map((i) => ({
              productoId: i.productoId,
              cantidad: i.cantidad,
              costoUnitario: i.costoUnitario,
              subtotal: Math.round(i.cantidad * i.costoUnitario),
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
        .select(['c.id', 'c.total', 'c.nota', 'c.created_at', 'u.nombre'])
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
        .select(['c.id', 'c.total', 'c.nota', 'c.created_at', 'u.nombre'])
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
