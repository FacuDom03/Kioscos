// Vencimientos por lote (etapa I7): qué vence pronto, para venderlo antes o sacarlo del estante.
import { diaArgentino, sumarDias, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { noEncontrado } from '../errores.ts';
import { validar } from '../validar.ts';

const TODOS = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const EDITAN = ['dueno', 'encargado', 'soporte'] as const;

export async function rutasVencimientos(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/vencimientos', { config: { roles: TODOS } }, async (req) => {
    const { dias } = validar(
      z.strictObject({ dias: z.coerce.number().int().min(1).max(365).default(60) }),
      req.query,
    );
    const hoy = diaArgentino();
    return req.db(async (tx) => {
      const lotes = await tx
        .selectFrom('lotes as l')
        .innerJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'l.producto_id').onRef('p.kiosco_id', '=', 'l.kiosco_id'),
        )
        .select(['l.id', 'l.producto_id', 'p.nombre', 'p.stock_actual', 'l.vence_en', 'l.cantidad'])
        .where('l.retirado', '=', false)
        .where('p.activo', '=', true)
        .where('l.vence_en', '<=', sumarDias(hoy, dias))
        .orderBy('l.vence_en')
        .orderBy('p.nombre')
        .limit(300)
        .execute();
      return {
        hoy,
        lotes: lotes.map((l) => ({
          id: l.id,
          productoId: l.producto_id,
          nombre: l.nombre,
          stock: Number(l.stock_actual),
          venceEn: l.vence_en,
          cantidad: Number(l.cantidad),
          vencido: l.vence_en < hoy,
        })),
      };
    });
  });

  app.post('/api/v1/lotes', { config: { roles: EDITAN } }, async (req) => {
    const d = validar(
      z.strictObject({
        productoId: z.uuid(),
        venceEn: z.iso.date(),
        cantidad: z.number().positive().max(1_000_000),
      }),
      req.body,
    );
    const id = uuidv7();
    await req.db(async (tx) => {
      const p = await tx
        .selectFrom('productos')
        .select('id')
        .where('id', '=', d.productoId)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      await tx
        .insertInto('lotes')
        .values({
          id,
          kiosco_id: req.completa.kioscoId,
          producto_id: d.productoId,
          vence_en: d.venceEn,
          cantidad: d.cantidad,
          usuario_id: req.completa.usuarioId,
        })
        .execute();
    });
    return { id };
  });

  // Ya no queda nada del lote (se vendió o se sacó del estante).
  app.post('/api/v1/lotes/:id/retirar', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('lotes')
        .set({ retirado: true, updated_at: new Date() })
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
    });
    return { ok: true };
  });
}
