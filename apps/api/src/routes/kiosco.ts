// Datos del kiosco, acceso de soporte (24 horas) y auditoría visible para el dueño.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';

export async function rutasKiosco(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/v1/kiosco',
    { config: { roles: ['dueno', 'encargado', 'cajero', 'soporte'] } },
    async (req) =>
      req.db(async (tx) => {
        const k = await tx
          .selectFrom('kioscos')
          .select(['id', 'nombre', 'plan', 'estado_suscripcion', 'soporte_hasta'])
          .executeTakeFirstOrThrow();
        const soporteActivo = !!k.soporte_hasta && k.soporte_hasta > new Date();
        return { ...k, soporte_hasta: soporteActivo ? k.soporte_hasta : null };
      }),
  );

  app.put('/api/v1/kiosco/soporte', { config: { roles: ['dueno'] } }, async (req) => {
    const { activo } = validar(z.strictObject({ activo: z.boolean() }), req.body);
    const hasta = activo ? new Date(Date.now() + 24 * 3600 * 1000) : null;
    await req.db(async (tx) => {
      await tx
        .updateTable('kioscos')
        .set({ soporte_hasta: hasta, updated_at: new Date() })
        .execute();
      await auditar(
        tx,
        req.completa,
        activo ? 'soporte.activado' : 'soporte.desactivado',
        {},
        req.ip,
      );
    });
    return { soporte_hasta: hasta };
  });

  app.get('/api/v1/auditoria', { config: { roles: ['dueno'] } }, async (req) =>
    req.db((tx) =>
      tx
        .selectFrom('auditoria as a')
        .leftJoin('usuarios as u', 'u.id', 'a.usuario_id')
        .select(['a.id', 'a.accion', 'a.detalle', 'a.es_soporte', 'a.created_at', 'u.nombre'])
        .orderBy('a.created_at', 'desc')
        .limit(200)
        .execute(),
    ),
  );
}
