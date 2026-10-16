// Caja: turno abierto con su resumen, gastos y cierre con conteo y diferencia (sección 10).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { resumenTurno, turnoAbierto } from '../servicios/ventas.ts';
import { validar } from '../validar.ts';

const VENDEN = ['dueno', 'encargado', 'cajero', 'soporte'] as const;

export async function rutasCaja(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/caja', { config: { roles: VENDEN } }, async (req) =>
    req.db(async (tx) => {
      const t = await turnoAbierto(tx);
      if (!t) return { turno: null };
      const [abrio, resumen, gastos] = await Promise.all([
        tx
          .selectFrom('usuarios')
          .select('nombre')
          .where('id', '=', t.abierto_por)
          .executeTakeFirst(),
        resumenTurno(tx, t.id, t.cambio_inicial),
        tx
          .selectFrom('gastos')
          .select(['id', 'tipo', 'monto', 'motivo', 'creado_en_dispositivo', 'created_at'])
          .where('turno_id', '=', t.id)
          .orderBy('created_at')
          .execute(),
      ]);
      return {
        turno: {
          id: t.id,
          abiertoEn: t.abierto_en,
          abiertoPor: abrio?.nombre ?? '',
          cambioInicial: t.cambio_inicial,
        },
        resumen,
        gastos,
      };
    }),
  );

  app.post(
    '/api/v1/caja/turnos/:id/cerrar',
    { config: { roles: ['dueno', 'encargado', 'cajero'] } },
    async (req) => {
      const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
      const d = validar(
        z.strictObject({
          contado: z.number().int().min(0).max(100_000_000_000),
          nota: z.string().trim().max(500).optional(),
        }),
        req.body,
      );
      const s = req.completa;
      return req.db(async (tx) => {
        const t = await tx
          .selectFrom('turnos_caja')
          .selectAll()
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!t) throw noEncontrado();
        if (t.cerrado_en) throw new ErrorPublico(409, 'ya_cerrada', 'Esta caja ya se cerró.');
        const r = await resumenTurno(tx, id, t.cambio_inicial);
        const diferencia = d.contado - r.deberiaHaber;
        await tx
          .updateTable('turnos_caja')
          .set({
            cerrado_por: s.usuarioId,
            cerrado_en: new Date(),
            esperado: r.deberiaHaber,
            contado: d.contado,
            diferencia,
            nota: d.nota ?? null,
          })
          .where('id', '=', id)
          .execute();
        return { resumen: r, contado: d.contado, diferencia };
      });
    },
  );

  // Cierres anteriores: el cajero no los ve.
  app.get(
    '/api/v1/caja/cierres',
    { config: { roles: ['dueno', 'encargado', 'soporte'] } },
    async (req) =>
      req.db((tx) =>
        tx
          .selectFrom('turnos_caja as t')
          .leftJoin('usuarios as a', 'a.id', 't.abierto_por')
          .leftJoin('usuarios as c', 'c.id', 't.cerrado_por')
          .select([
            't.id',
            't.abierto_en',
            't.cerrado_en',
            't.cambio_inicial',
            't.esperado',
            't.contado',
            't.diferencia',
            't.nota',
            'a.nombre as abrio',
            'c.nombre as cerro',
          ])
          .where('t.cerrado_en', 'is not', null)
          .orderBy('t.cerrado_en', 'desc')
          .limit(60)
          .execute(),
      ),
  );

  // Detalle de un turno (para tocar un cierre anterior): totales, gastos y retiros.
  app.get(
    '/api/v1/caja/cierres/:id',
    { config: { roles: ['dueno', 'encargado', 'soporte'] } },
    async (req) => {
      const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
      return req.db(async (tx) => {
        const t = await tx
          .selectFrom('turnos_caja as t')
          .leftJoin('usuarios as a', 'a.id', 't.abierto_por')
          .leftJoin('usuarios as c', 'c.id', 't.cerrado_por')
          .select([
            't.id',
            't.abierto_en',
            't.cerrado_en',
            't.cambio_inicial',
            't.esperado',
            't.contado',
            't.diferencia',
            't.nota',
            'a.nombre as abrio',
            'c.nombre as cerro',
          ])
          .where('t.id', '=', id)
          .executeTakeFirst();
        if (!t) throw noEncontrado();
        const [resumen, gastos] = await Promise.all([
          resumenTurno(tx, t.id, t.cambio_inicial),
          tx
            .selectFrom('gastos as g')
            .leftJoin('usuarios as u', 'u.id', 'g.usuario_id')
            .select(['g.id', 'g.tipo', 'g.monto', 'g.motivo', 'g.created_at', 'u.nombre'])
            .where('g.turno_id', '=', t.id)
            .orderBy('g.created_at')
            .execute(),
        ]);
        return { turno: t, resumen, gastos };
      });
    },
  );
}
