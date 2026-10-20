// Personalización del comercio: logo y texto al pie para lo que se imprime, y marca de agua en
// los presupuestos. Lo configura el dueño; el logo lo ven todos (va en el ticket del cajero).
import type { FastifyInstance } from 'fastify';
import { uuidv7 } from '@mostrador/shared';
import type { TxKiosco } from '@mostrador/db';
import { z } from 'zod';
import { datosInvalidos, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';

const DUENO = ['dueno'] as const;
const TODOS = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const MAXIMO = 150 * 1024;

/** Qué tipo de imagen es por sus primeros bytes (no por lo que dice el pedido). */
function tipoDeImagen(b: Buffer): 'image/png' | 'image/jpeg' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/** La personalización para la sesión y la pantalla (sin la imagen). */
export async function marcaDelNegocio(tx: TxKiosco) {
  const p = await tx
    .selectFrom('personalizacion')
    .select(['logo_tipo', 'logo_version', 'logo_en_ticket', 'marca_agua', 'pie'])
    .executeTakeFirst();
  return {
    logo: p?.logo_tipo ? p.logo_version : null,
    logoEnTicket: p?.logo_en_ticket ?? true,
    marcaAgua: p?.marca_agua ?? false,
    pie: p?.pie ?? null,
  };
}

async function guardar(
  tx: TxKiosco,
  kioscoId: string,
  cambios: {
    logo?: Buffer | null;
    logo_tipo?: 'image/png' | 'image/jpeg' | null;
    logo_en_ticket?: boolean;
    marca_agua?: boolean;
    pie?: string | null;
  },
) {
  const previa = await tx.selectFrom('personalizacion').select('id').executeTakeFirst();
  const nuevoLogo = cambios.logo !== undefined;
  if (previa)
    await tx
      .updateTable('personalizacion')
      .set((eb) => ({
        ...cambios,
        ...(nuevoLogo ? { logo_version: eb('logo_version', '+', 1) } : {}),
        updated_at: new Date(),
      }))
      .where('id', '=', previa.id)
      .execute();
  else
    await tx
      .insertInto('personalizacion')
      .values({ id: uuidv7(), kiosco_id: kioscoId, ...cambios, logo_version: nuevoLogo ? 1 : 0 })
      .execute();
}

export async function rutasPersonalizacion(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/personalizacion', { config: { roles: TODOS } }, async (req) =>
    req.db((tx) => marcaDelNegocio(tx)),
  );

  app.put('/api/v1/personalizacion', { config: { roles: DUENO } }, async (req) => {
    const d = validar(
      z.strictObject({
        pie: z.string().trim().max(200).nullable(),
        logoEnTicket: z.boolean(),
        marcaAgua: z.boolean(),
      }),
      req.body,
    );
    return req.db(async (tx) => {
      await guardar(tx, req.completa.kioscoId, {
        pie: d.pie || null,
        logo_en_ticket: d.logoEnTicket,
        marca_agua: d.marcaAgua,
      });
      await auditar(tx, req.completa, 'personalizacion.textos', {}, req.ip);
      return marcaDelNegocio(tx);
    });
  });

  // La app manda el logo ya achicado (en base64). Se revisa que de verdad sea PNG o JPEG.
  app.put(
    '/api/v1/personalizacion/logo',
    { config: { roles: DUENO, rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req) => {
      const { datos } = validar(
        z.strictObject({ datos: z.base64().max(Math.ceil((MAXIMO * 4) / 3) + 4) }),
        req.body,
      );
      const imagen = Buffer.from(datos, 'base64');
      const tipo = tipoDeImagen(imagen);
      if (!tipo || imagen.length > MAXIMO)
        throw datosInvalidos('El logo tiene que ser una imagen PNG o JPG de hasta 150 KB.');
      return req.db(async (tx) => {
        await guardar(tx, req.completa.kioscoId, { logo: imagen, logo_tipo: tipo });
        await auditar(tx, req.completa, 'personalizacion.logo', { bytes: imagen.length }, req.ip);
        return marcaDelNegocio(tx);
      });
    },
  );

  app.delete('/api/v1/personalizacion/logo', { config: { roles: DUENO } }, async (req) =>
    req.db(async (tx) => {
      await guardar(tx, req.completa.kioscoId, { logo: null, logo_tipo: null });
      await auditar(tx, req.completa, 'personalizacion.logo_borrado', {}, req.ip);
      return marcaDelNegocio(tx);
    }),
  );

  // La imagen. La dirección lleva la versión (?v=3): el navegador la guarda y la usa sin
  // internet; con un logo nuevo cambia la dirección.
  app.get('/api/v1/personalizacion/logo', { config: { roles: TODOS } }, async (req, reply) => {
    const p = await req.db((tx) =>
      tx.selectFrom('personalizacion').select(['logo', 'logo_tipo']).executeTakeFirst(),
    );
    if (!p?.logo || !p.logo_tipo) throw noEncontrado();
    return reply
      .type(p.logo_tipo)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-disposition', 'inline; filename="logo"')
      .send(p.logo);
  });
}
