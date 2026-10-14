// Dispositivos autorizados: el dueño, ya autenticado, toca "Autorizar este equipo". El equipo
// guarda una credencial aleatoria en una cookie HttpOnly; en la base queda solo su hash.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { noEncontrado } from '../errores.ts';
import { hashToken, tokenAleatorio } from '@mostrador/servidor';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';

const COOKIE_SEGURA = '__Host-mostrador-equipo';
const COOKIE_DEV = 'mostrador_equipo';

export function leerCookieEquipo(app: FastifyInstance, req: FastifyRequest): string | undefined {
  return req.cookies[app.config.cookiesSeguras ? COOKIE_SEGURA : COOKIE_DEV];
}

export async function rutasDispositivos(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/dispositivos', { config: { roles: ['dueno'] } }, async (req) => {
    const propio = leerCookieEquipo(app, req);
    const hashPropio = propio ? hashToken(propio) : null;
    const filas = await req.db((tx) =>
      tx
        .selectFrom('dispositivos')
        .select(['id', 'nombre', 'ultimo_uso', 'created_at', 'credencial_hash'])
        .where('revocado_en', 'is', null)
        .orderBy('created_at')
        .execute(),
    );
    return filas.map(({ credencial_hash, ...d }) => ({
      ...d,
      esEste: credencial_hash === hashPropio,
    }));
  });

  app.post('/api/v1/dispositivos', { config: { roles: ['dueno'] } }, async (req, reply) => {
    const { nombre } = validar(
      z.strictObject({ nombre: z.string().trim().min(1).max(60) }),
      req.body,
    );
    const credencial = tokenAleatorio();
    const id = uuidv7();
    await req.db(async (tx) => {
      await tx
        .insertInto('dispositivos')
        .values({
          id,
          kiosco_id: req.completa.kioscoId,
          nombre,
          credencial_hash: hashToken(credencial),
        })
        .execute();
      await auditar(tx, req.completa, 'dispositivo.alta', { id, nombre }, req.ip);
    });
    reply.setCookie(app.config.cookiesSeguras ? COOKIE_SEGURA : COOKIE_DEV, credencial, {
      httpOnly: true,
      secure: app.config.cookiesSeguras,
      sameSite: 'lax',
      path: '/',
      maxAge: 400 * 24 * 3600,
    });
    return { id, nombre };
  });

  app.delete('/api/v1/dispositivos/:id', { config: { roles: ['dueno'] } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('dispositivos')
        .set({ revocado_en: new Date(), updated_at: new Date() })
        .where('id', '=', id)
        .where('revocado_en', 'is', null)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
      await auditar(tx, req.completa, 'dispositivo.baja', { id }, req.ip);
    });
    return { ok: true };
  });
}
