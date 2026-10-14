// Usuarios del kiosco (solo el dueño): cajeros con PIN e invitaciones a encargados.
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { hashPassword } from '@mostrador/servidor';
import { hashToken, tokenAleatorio } from '@mostrador/servidor';
import { auditar } from '../servicios/auditoria.ts';
import { crearCajero, crearInvitacion } from '../servicios/miembros.ts';
import { validar } from '../validar.ts';

const pin = z.string().regex(/^\d{4,6}$/, 'El PIN tiene de 4 a 6 números.');

export async function rutasUsuarios(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/usuarios', { config: { roles: ['dueno'] } }, async (req) =>
    req.db(async (tx) => {
      const personas = await tx
        .selectFrom('membresias as m')
        .innerJoin('usuarios as u', 'u.id', 'm.usuario_id')
        .leftJoin('pines as p', (j) =>
          j.onRef('p.membresia_id', '=', 'm.id').onRef('p.kiosco_id', '=', 'm.kiosco_id'),
        )
        .select([
          'm.id',
          'u.nombre',
          'u.email',
          'm.rol',
          'm.activa',
          'm.usuario_id',
          'p.id as pin_id',
        ])
        .orderBy('m.created_at')
        .execute();
      const invitaciones = await tx
        .selectFrom('invitaciones')
        .select(['id', 'email', 'rol', 'vence_en'])
        .where('usada_en', 'is', null)
        .where('vence_en', '>', new Date())
        .orderBy('created_at')
        .execute();
      return {
        personas: personas.map(({ pin_id, usuario_id, ...p }) => ({
          ...p,
          tienePin: !!pin_id,
          esVos: usuario_id === req.completa.usuarioId,
        })),
        invitaciones,
      };
    }),
  );

  app.post('/api/v1/usuarios/cajeros', { config: { roles: ['dueno'] } }, async (req) => {
    const datos = validar(
      z.strictObject({ nombre: z.string().trim().min(1).max(60), pin }),
      req.body,
    );
    const pinHash = await hashPassword(datos.pin);
    return req.db(async (tx) => {
      const ids = await crearCajero(tx, datos.nombre);
      await tx
        .insertInto('pines')
        .values({
          id: uuidv7(),
          kiosco_id: req.completa.kioscoId,
          membresia_id: ids.membresia,
          pin_hash: pinHash,
        })
        .execute();
      await auditar(
        tx,
        req.completa,
        'usuario.alta',
        { membresia: ids.membresia, rol: 'cajero' },
        req.ip,
      );
      return { id: ids.membresia };
    });
  });

  app.put('/api/v1/usuarios/:id/pin', { config: { roles: ['dueno'] } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    const datos = validar(z.strictObject({ pin }), req.body);
    const pinHash = await hashPassword(datos.pin);
    await req.db(async (tx) => {
      const m = await tx
        .selectFrom('membresias')
        .select(['id', 'rol'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!m) throw noEncontrado();
      if (m.rol !== 'cajero') throw new ErrorPublico(400, 'rol', 'El PIN es solo para cajeros.');
      const r = await tx
        .updateTable('pines')
        .set({
          pin_hash: pinHash,
          intentos_fallidos: 0,
          bloqueado_hasta: null,
          updated_at: new Date(),
        })
        .where('membresia_id', '=', id)
        .executeTakeFirst();
      if (!r.numUpdatedRows) {
        await tx
          .insertInto('pines')
          .values({
            id: uuidv7(),
            kiosco_id: req.completa.kioscoId,
            membresia_id: id,
            pin_hash: pinHash,
          })
          .execute();
      }
      await auditar(tx, req.completa, 'usuario.pin', { membresia: id }, req.ip);
    });
    return { ok: true };
  });

  app.patch('/api/v1/usuarios/:id', { config: { roles: ['dueno'] } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    const { activa } = validar(z.strictObject({ activa: z.boolean() }), req.body);
    await req.db(async (tx) => {
      const m = await tx
        .selectFrom('membresias')
        .select(['id', 'rol', 'usuario_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!m) throw noEncontrado();
      if (m.usuario_id === req.completa.usuarioId || m.rol === 'dueno') {
        throw new ErrorPublico(400, 'dueno', 'No se puede desactivar al dueño.');
      }
      await tx
        .updateTable('membresias')
        .set({ activa, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      await auditar(
        tx,
        req.completa,
        activa ? 'usuario.reactivado' : 'usuario.baja',
        { membresia: id },
        req.ip,
      );
    });
    return { ok: true };
  });

  app.post('/api/v1/usuarios/invitaciones', { config: { roles: ['dueno'] } }, async (req) => {
    const { email } = validar(z.strictObject({ email: z.email().max(254) }), req.body);
    const token = tokenAleatorio();
    const id = uuidv7();
    await req.db(async (tx) => {
      await crearInvitacion(tx, {
        id,
        email,
        rol: 'encargado',
        tokenHash: hashToken(token),
        creadaPor: req.completa.usuarioId,
      });
      await auditar(
        tx,
        req.completa,
        'usuario.invitacion',
        { invitacion: id, rol: 'encargado' },
        req.ip,
      );
    });
    return { id, enlace: `${app.config.origen}/invitacion#${token}` };
  });

  app.delete('/api/v1/usuarios/invitaciones/:id', { config: { roles: ['dueno'] } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('invitaciones')
        .set({ vence_en: new Date() })
        .where('id', '=', id)
        .where('usada_en', 'is', null)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
      await auditar(tx, req.completa, 'usuario.invitacion_cancelada', { invitacion: id }, req.ip);
    });
    return { ok: true };
  });
}
