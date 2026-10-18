// Claves de API y avisos automáticos (docs/API.md). Solo el dueño los maneja, desde Más → API y
// automatizaciones. La clave y el secreto de cada aviso se muestran una sola vez.
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from '@mostrador/shared';
import { EVENTOS_AVISO, entregarAviso, problemaDeUrl, tokenAleatorio } from '@mostrador/servidor';
import { z } from 'zod';
import { datosInvalidos, ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { nuevaClaveApi } from '../servicios/claves-api.ts';
import { validar } from '../validar.ts';

const DUENO = ['dueno'] as const;
const MAX_CLAVES = 10;
const MAX_AVISOS = 5;
const conId = z.strictObject({ id: z.uuid() });

export async function rutasApiNegocio(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/claves-api', { config: { roles: DUENO } }, async (req) =>
    req.db(async (tx) => {
      const filas = await tx
        .selectFrom('claves_api')
        .select(['id', 'nombre', 'prefijo', 'permisos', 'created_at', 'ultimo_uso', 'revocada_en'])
        .orderBy('created_at', 'desc')
        .limit(50)
        .execute();
      return filas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        prefijo: c.prefijo,
        permisos: c.permisos,
        creadaEn: c.created_at,
        ultimoUso: c.ultimo_uso,
        revocadaEn: c.revocada_en,
      }));
    }),
  );

  app.post('/api/v1/claves-api', { config: { roles: DUENO } }, async (req) => {
    const d = validar(
      z.strictObject({ nombre: z.string().trim().min(1).max(60), clientes: z.boolean() }),
      req.body,
    );
    const s = req.completa;
    return req.db(async (tx) => {
      const activas = await tx
        .selectFrom('claves_api')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('revocada_en', 'is', null)
        .executeTakeFirstOrThrow();
      if (Number(activas.n) >= MAX_CLAVES)
        throw new ErrorPublico(
          409,
          'demasiadas_claves',
          `Ya tenés ${MAX_CLAVES} claves activas. Revocá alguna que no uses.`,
        );
      const { clave, prefijo, hash } = nuevaClaveApi();
      const id = uuidv7();
      const permisos = d.clientes ? ['clientes'] : [];
      await tx
        .insertInto('claves_api')
        .values({
          id,
          kiosco_id: s.kioscoId,
          nombre: d.nombre,
          prefijo,
          token_hash: hash,
          permisos,
          creada_por: s.usuarioId,
        })
        .execute();
      await auditar(tx, s, 'clave_api.creada', { id, nombre: d.nombre, permisos }, req.ip);
      return { id, nombre: d.nombre, prefijo, permisos, clave };
    });
  });

  app.delete('/api/v1/claves-api/:id', { config: { roles: DUENO } }, async (req) => {
    const { id } = validar(conId, req.params);
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('claves_api')
        .set({ revocada_en: new Date() })
        .where('id', '=', id)
        .where('revocada_en', 'is', null)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
      await auditar(tx, req.completa, 'clave_api.revocada', { id }, req.ip);
    });
    return { ok: true };
  });

  app.get('/api/v1/avisos', { config: { roles: DUENO } }, async (req) =>
    req.db(async (tx) => {
      const filas = await tx
        .selectFrom('webhooks')
        .select([
          'id',
          'url',
          'eventos',
          'activo',
          'ultimo_envio',
          'ultimo_estado',
          'fallos_seguidos',
          'created_at',
        ])
        .orderBy('created_at')
        .execute();
      return filas.map((w) => ({
        id: w.id,
        url: w.url,
        eventos: w.eventos,
        activo: w.activo,
        ultimoEnvio: w.ultimo_envio,
        ultimoEstado: w.ultimo_estado,
        fallosSeguidos: w.fallos_seguidos,
        creadoEn: w.created_at,
      }));
    }),
  );

  app.post('/api/v1/avisos', { config: { roles: DUENO } }, async (req) => {
    const d = validar(
      z.strictObject({
        url: z.string().trim().max(500),
        eventos: z
          .array(z.enum(EVENTOS_AVISO))
          .min(1)
          .max(EVENTOS_AVISO.length)
          .refine((e) => new Set(e).size === e.length),
      }),
      req.body,
    );
    const problema = problemaDeUrl(d.url);
    if (problema) throw datosInvalidos(problema);
    const s = req.completa;
    return req.db(async (tx) => {
      const cuantos = await tx
        .selectFrom('webhooks')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow();
      if (Number(cuantos.n) >= MAX_AVISOS)
        throw new ErrorPublico(
          409,
          'demasiados_avisos',
          `Ya tenés ${MAX_AVISOS} avisos. Quitá alguno que no uses.`,
        );
      const secreto = `whsec_${tokenAleatorio(32)}`;
      const { datos, version } = app.cifrador.cifrar(secreto);
      const id = uuidv7();
      await tx
        .insertInto('webhooks')
        .values({
          id,
          kiosco_id: s.kioscoId,
          url: d.url,
          eventos: d.eventos,
          secreto_cifrado: datos,
          clave_version: version,
          creado_por: s.usuarioId,
        })
        .execute();
      await auditar(
        tx,
        s,
        'aviso.creado',
        { id, sitio: new URL(d.url).hostname, eventos: d.eventos },
        req.ip,
      );
      return { id, secreto };
    });
  });

  // Pausar o volver a activar (por ejemplo, después de que se pausó solo por errores).
  app.patch('/api/v1/avisos/:id', { config: { roles: DUENO } }, async (req) => {
    const { id } = validar(conId, req.params);
    const { activo } = validar(z.strictObject({ activo: z.boolean() }), req.body);
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('webhooks')
        .set({ activo, ...(activo ? { fallos_seguidos: 0 } : {}), updated_at: new Date() })
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
      await auditar(tx, req.completa, activo ? 'aviso.activado' : 'aviso.pausado', { id }, req.ip);
    });
    return { ok: true };
  });

  app.delete('/api/v1/avisos/:id', { config: { roles: DUENO } }, async (req) => {
    const { id } = validar(conId, req.params);
    await req.db(async (tx) => {
      const r = await tx.deleteFrom('webhooks').where('id', '=', id).executeTakeFirst();
      if (!r.numDeletedRows) throw noEncontrado();
      await auditar(tx, req.completa, 'aviso.quitado', { id }, req.ip);
    });
    return { ok: true };
  });

  // Manda un aviso de prueba en el momento y devuelve qué respondió la herramienta.
  app.post(
    '/api/v1/avisos/:id/probar',
    { config: { roles: DUENO, rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const { id } = validar(conId, req.params);
      validar(z.strictObject({}), req.body ?? {});
      const s = req.completa;
      const existe = await req.db((tx) =>
        tx.selectFrom('webhooks').select('id').where('id', '=', id).executeTakeFirst(),
      );
      if (!existe) throw noEncontrado();
      const r = await entregarAviso(
        app.base,
        app.cifrador,
        s.kioscoId,
        id,
        {
          id: uuidv7(),
          evento: 'prueba',
          creado: new Date().toISOString(),
          datos: { mensaje: 'Aviso de prueba de Mostrador' },
        },
        app.opcionesEnvio,
      );
      return { enviado: r.enviado, estado: r.estado };
    },
  );
}
