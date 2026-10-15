// Promos automáticas (etapa I7). La regla (lleva, paga, descuento y a qué se aplica) no se edita
// una vez creada: las ventas hechas sin conexión se validan con ella. Se cambia el nombre, se le
// pone fecha de fin o se apaga.
import { diaArgentino, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';

const EDITAN = ['dueno', 'encargado', 'soporte'] as const;
const idParam = z.strictObject({ id: z.uuid() });
const nombre = z.string().trim().min(1).max(80);

export async function rutasPromos(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/promos', { config: { roles: EDITAN } }, async (req) =>
    req.db(async (tx) => {
      const filas = await tx
        .selectFrom('promos as p')
        .leftJoin('categorias as c', (j) =>
          j.onRef('c.id', '=', 'p.categoria_id').onRef('c.kiosco_id', '=', 'p.kiosco_id'),
        )
        .leftJoin('grupos_variantes as g', (j) =>
          j.onRef('g.id', '=', 'p.grupo_id').onRef('g.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select([
          'p.id',
          'p.nombre',
          'p.lleva',
          'p.paga',
          'p.descuento',
          'p.categoria_id',
          'p.grupo_id',
          'p.desde',
          'p.hasta',
          'p.activa',
          'c.nombre as categoria',
          'g.nombre as grupo',
        ])
        .orderBy('p.activa', 'desc')
        .orderBy('p.created_at', 'desc')
        .execute();
      const hoy = diaArgentino();
      // Cuánto descontó cada una en los últimos 30 días.
      const uso = await tx
        .selectFrom('venta_descuentos as d')
        .innerJoin('ventas as v', (j) =>
          j.onRef('v.id', '=', 'd.venta_id').onRef('v.kiosco_id', '=', 'd.kiosco_id'),
        )
        .select(['d.promo_id'])
        .select((eb) => [
          eb.fn.sum<string>('d.monto').as('monto'),
          eb.fn.countAll<string>().as('ventas'),
        ])
        .where('v.estado', '=', 'cobrada')
        .where('v.creada_en_dispositivo', '>=', new Date(Date.now() - 30 * 24 * 3600_000))
        .groupBy('d.promo_id')
        .execute();
      return filas.map((p) => {
        const u = uso.find((x) => x.promo_id === p.id);
        return {
          id: p.id,
          nombre: p.nombre,
          lleva: p.lleva,
          paga: p.paga,
          descuento: p.descuento,
          categoriaId: p.categoria_id,
          grupoId: p.grupo_id,
          alcance: p.grupo ?? p.categoria ?? '',
          desde: p.desde,
          hasta: p.hasta,
          activa: p.activa,
          estado: !p.activa
            ? 'apagada'
            : p.hasta && p.hasta < hoy
              ? 'terminada'
              : p.desde && p.desde > hoy
                ? 'programada'
                : 'corriendo',
          descontado30: Number(u?.monto ?? 0),
          ventas30: Number(u?.ventas ?? 0),
        };
      });
    }),
  );

  app.post('/api/v1/promos', { config: { roles: EDITAN } }, async (req) => {
    const d = validar(
      z
        .strictObject({
          nombre,
          lleva: z.number().int().min(2).max(12),
          paga: z.number().int().min(1).max(11),
          descuento: z.number().int().min(1).max(100),
          categoriaId: z.uuid().optional(),
          grupoId: z.uuid().optional(),
          desde: z.iso.date().optional(),
          hasta: z.iso.date().optional(),
        })
        .refine((x) => x.paga < x.lleva, 'Tiene que pagar menos de lo que lleva.')
        .refine((x) => !x.categoriaId !== !x.grupoId, 'Elegí a qué se aplica.')
        .refine((x) => !x.desde || !x.hasta || x.desde <= x.hasta, 'Las fechas están al revés.'),
      req.body,
    );
    const id = uuidv7();
    await req.db(async (tx) => {
      const existe = d.grupoId
        ? await tx
            .selectFrom('grupos_variantes')
            .select('id')
            .where('id', '=', d.grupoId)
            .executeTakeFirst()
        : await tx
            .selectFrom('categorias')
            .select('id')
            .where('id', '=', d.categoriaId ?? '')
            .executeTakeFirst();
      if (!existe) throw noEncontrado();
      await tx
        .insertInto('promos')
        .values({
          id,
          kiosco_id: req.completa.kioscoId,
          nombre: d.nombre,
          lleva: d.lleva,
          paga: d.paga,
          descuento: d.descuento,
          categoria_id: d.categoriaId ?? null,
          grupo_id: d.grupoId ?? null,
          desde: d.desde ?? null,
          hasta: d.hasta ?? null,
        })
        .execute();
      await auditar(
        tx,
        req.completa,
        'promo.creada',
        { promoId: id, lleva: d.lleva, paga: d.paga, descuento: d.descuento },
        req.ip,
      );
    });
    return { id };
  });

  app.patch('/api/v1/promos/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      z.strictObject({
        nombre: nombre.optional(),
        hasta: z.iso.date().nullable().optional(),
        activa: z.boolean().optional(),
      }),
      req.body,
    );
    await req.db(async (tx) => {
      const p = await tx
        .selectFrom('promos')
        .select(['id', 'desde'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      if (d.hasta && p.desde && d.hasta < p.desde)
        throw new ErrorPublico(400, 'datos_invalidos', 'Las fechas están al revés.');
      await tx
        .updateTable('promos')
        .set({ ...d, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await auditar(tx, req.completa, 'promo.cambiada', { promoId: id, ...d }, req.ip);
    });
    return { ok: true };
  });
}
