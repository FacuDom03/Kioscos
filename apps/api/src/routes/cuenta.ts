// Seguridad de la propia cuenta: passkeys, códigos de recuperación y contraseña.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { hashPassword, verificarPassword } from '@mostrador/servidor';
import { hashToken } from '@mostrador/servidor';
import { normalizarCodigoRecuperacion, nuevosCodigosRecuperacion } from '@mostrador/servidor';
import { auditar } from '../servicios/auditoria.ts';
import {
  activarSegundoFactor,
  borrarPasskey,
  leerTotp,
  listarPasskeys,
} from '../servicios/cuentas.ts';
import { borrarOtrasSesiones } from '../servicios/sesiones.ts';
import { validar } from '../validar.ts';

const ROLES = ['dueno', 'encargado'] as const;

export async function rutasCuenta(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/cuenta/seguridad', { config: { roles: ROLES } }, async (req) => {
    const s = req.completa;
    const [totp, passkeys, codigos] = await Promise.all([
      leerTotp(app.base, s.usuarioId),
      listarPasskeys(app.base, s.usuarioId),
      req.db((tx) =>
        tx
          .selectFrom('usuarios')
          .select('codigos_recuperacion')
          .where('id', '=', s.usuarioId)
          .executeTakeFirst(),
      ),
    ]);
    return {
      totp: !!totp?.totp_secreto_cifrado,
      passkeys,
      codigosRestantes: codigos?.codigos_recuperacion.length ?? 0,
    };
  });

  app.post('/api/v1/cuenta/codigos', { config: { roles: ROLES } }, async (req) => {
    validar(z.strictObject({}).optional(), req.body);
    const codigos = nuevosCodigosRecuperacion();
    await activarSegundoFactor(
      app.base,
      req.completa.usuarioId,
      codigos.map((c) => hashToken(normalizarCodigoRecuperacion(c))),
    );
    await req.db((tx) => auditar(tx, req.completa, 'cuenta.codigos', {}, req.ip));
    return { codigosRecuperacion: codigos };
  });

  app.delete('/api/v1/cuenta/passkeys/:id', { config: { roles: ROLES } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    const s = req.completa;
    const [totp, passkeys] = await Promise.all([
      leerTotp(app.base, s.usuarioId),
      listarPasskeys(app.base, s.usuarioId),
    ]);
    if (!passkeys.some((p) => p.id === id)) throw noEncontrado();
    if (!totp?.totp_secreto_cifrado && passkeys.length <= 1) {
      throw new ErrorPublico(
        400,
        'ultimo_factor',
        'Es tu único segundo factor. Agregá otro antes de borrarlo.',
      );
    }
    await borrarPasskey(app.base, s.usuarioId, id);
    await req.db((tx) => auditar(tx, s, 'cuenta.passkey_borrada', {}, req.ip));
    return { ok: true };
  });

  app.post(
    '/api/v1/cuenta/password',
    { config: { roles: ROLES, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const datos = validar(
        z.strictObject({ actual: z.string().min(1).max(128), nueva: z.string().min(10).max(128) }),
        req.body,
      );
      const s = req.completa;
      const nuevaHash = await hashPassword(datos.nueva);
      await req.db(async (tx) => {
        const u = await tx
          .selectFrom('usuarios')
          .select('password_hash')
          .where('id', '=', s.usuarioId)
          .executeTakeFirst();
        if (!u || !(await verificarPassword(u.password_hash, datos.actual))) {
          throw new ErrorPublico(400, 'password', 'La contraseña actual no es correcta.');
        }
        await tx
          .updateTable('usuarios')
          .set({ password_hash: nuevaHash, updated_at: new Date() })
          .where('id', '=', s.usuarioId)
          .execute();
        await auditar(tx, s, 'cuenta.password', {}, req.ip);
      });
      // Se cierran las demás sesiones abiertas de la persona.
      await borrarOtrasSesiones(app.base, s.usuarioId, s.tokenHash);
      return { ok: true };
    },
  );
}
