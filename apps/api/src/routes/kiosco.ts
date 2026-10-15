// Datos del kiosco, rubro y funciones, acceso de soporte (24 horas) y auditoría visible para el
// dueño.
import { DATOS_MODULOS, MODULOS, RUBROS, moduloEnPlan, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico } from '../errores.ts';
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
          .select([
            'id',
            'nombre',
            'plan',
            'rubro',
            'modulos',
            'configurado',
            'estado_suscripcion',
            'soporte_hasta',
          ])
          .executeTakeFirstOrThrow();
        const soporteActivo = !!k.soporte_hasta && k.soporte_hasta > new Date();
        return { ...k, soporte_hasta: soporteActivo ? k.soporte_hasta : null };
      }),
  );

  // Rubro, funciones y categorías. Lo usa el dueño al armar el negocio la primera vez y
  // después desde Más. Las categorías solo se agregan (las que ya existen quedan como están).
  app.put('/api/v1/kiosco/negocio', { config: { roles: ['dueno'] } }, async (req) => {
    const d = validar(
      z.strictObject({
        rubro: z.enum(RUBROS),
        modulos: z.array(z.enum(MODULOS)).max(MODULOS.length),
        categorias: z.array(z.string().trim().min(1).max(60)).max(30),
      }),
      req.body,
    );
    const modulos = [...new Set(d.modulos)];
    return req.db(async (tx) => {
      const { plan } = await tx.selectFrom('kioscos').select('plan').executeTakeFirstOrThrow();
      const fuera = modulos.filter((m) => !moduloEnPlan(m, plan));
      if (fuera.length)
        throw new ErrorPublico(
          403,
          'fuera_del_plan',
          `${fuera.map((m) => DATOS_MODULOS[m].nombre).join(' y ')}: es del plan Comercio.`,
        );
      const existentes = await tx.selectFrom('categorias').select(['nombre', 'orden']).execute();
      const nombres = new Set(existentes.map((c) => c.nombre.toLowerCase()));
      let orden = Math.max(0, ...existentes.map((c) => c.orden));
      const nuevas: string[] = [];
      for (const nombre of d.categorias) {
        if (nombres.has(nombre.toLowerCase())) continue;
        nombres.add(nombre.toLowerCase());
        nuevas.push(nombre);
      }
      if (nuevas.length) {
        await tx
          .insertInto('categorias')
          .values(
            nuevas.map((nombre) => ({
              id: uuidv7(),
              kiosco_id: req.completa.kioscoId,
              nombre,
              orden: ++orden,
            })),
          )
          .execute();
      }
      await tx
        .updateTable('kioscos')
        .set({ rubro: d.rubro, modulos, configurado: true, updated_at: new Date() })
        .execute();
      await auditar(
        tx,
        req.completa,
        'kiosco.negocio',
        { rubro: d.rubro, modulos, categoriasNuevas: nuevas.length },
        req.ip,
      );
      return { rubro: d.rubro, modulos, configurado: true, categoriasNuevas: nuevas.length };
    });
  });

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
