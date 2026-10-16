// Movimientos de stock (historial): cada venta, compra, ajuste y anulación que movió un
// producto. Lo ven el dueño y el encargado.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validar } from '../validar.ts';

const VEN = ['dueno', 'encargado', 'soporte'] as const;
const desdeAR = (d: string) => new Date(`${d}T00:00:00-03:00`);

export async function rutasMovimientos(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/movimientos-stock', { config: { roles: VEN } }, async (req) => {
    const { productoId, desde, hasta } = validar(
      z.strictObject({
        productoId: z.uuid().optional(),
        desde: z.iso.date().optional(),
        hasta: z.iso.date().optional(),
      }),
      req.query,
    );
    return req.db(async (tx) => {
      let q = tx
        .selectFrom('movimientos_stock as m')
        .innerJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'm.producto_id').onRef('p.kiosco_id', '=', 'm.kiosco_id'),
        )
        .leftJoin('usuarios as u', 'u.id', 'm.usuario_id')
        .select([
          'm.id',
          'm.producto_id',
          'p.nombre as producto',
          'p.unidad',
          'm.tipo',
          'm.cantidad',
          'm.motivo',
          'm.venta_id',
          'm.compra_id',
          'm.created_at',
          'u.nombre',
        ])
        .orderBy('m.created_at', 'desc')
        .limit(300);
      if (productoId) q = q.where('m.producto_id', '=', productoId);
      if (desde) q = q.where('m.created_at', '>=', desdeAR(desde));
      if (hasta) q = q.where('m.created_at', '<', new Date(desdeAR(hasta).getTime() + 86_400_000));
      const filas = await q.execute();
      return filas.map((f) => ({ ...f, cantidad: Number(f.cantidad) }));
    });
  });
}
