// Productos con variantes (etapa I7, docs/decisiones/009-rubros.md): un esmalte en doce tonos
// son doce productos, cada uno con su stock y su código, juntos en un grupo.
import { sql } from '@mostrador/db';
import { uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { validar } from '../validar.ts';
import { crearProducto, datosProducto } from './catalogo.ts';

const TODOS = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const EDITAN = ['dueno', 'encargado', 'soporte'] as const;
const TIPOS = ['tono', 'tamano', 'aroma', 'talle', 'otro'] as const;

const idParam = z.strictObject({ id: z.uuid() });
const nombreGrupo = z.string().trim().min(1).max(100);
const variante = z.strictObject({
  variante: z.string().trim().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/)
    .optional(),
  codigo: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z\-.]{1,48}$/)
    .optional(),
  stockInicial: z.number().min(0).max(1_000_000).optional(),
});

const nombreDe = (grupo: string, v: string) => `${grupo} ${v}`.slice(0, 120);

export async function rutasVariantes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/grupos-variantes', { config: { roles: TODOS } }, async (req) =>
    req.db(async (tx) => {
      const grupos = await tx
        .selectFrom('grupos_variantes as g')
        .leftJoin('productos as p', (j) =>
          j
            .onRef('p.grupo_id', '=', 'g.id')
            .onRef('p.kiosco_id', '=', 'g.kiosco_id')
            .on('p.activo', '=', true),
        )
        .select(['g.id', 'g.nombre', 'g.tipo'])
        .select((eb) => [
          eb.fn.count<string>('p.id').as('variantes'),
          eb.fn.coalesce(eb.fn.sum<string>('p.stock_actual'), sql<string>`0`).as('stock'),
        ])
        .groupBy(['g.id', 'g.nombre', 'g.tipo'])
        .orderBy('g.nombre')
        .execute();
      return grupos.map((g) => ({ ...g, variantes: Number(g.variantes), stock: Number(g.stock) }));
    }),
  );

  app.get('/api/v1/grupos-variantes/:id', { config: { roles: TODOS } }, async (req) => {
    const { id } = validar(idParam, req.params);
    return req.db(async (tx) => {
      const g = await tx
        .selectFrom('grupos_variantes')
        .select(['id', 'nombre', 'tipo'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!g) throw noEncontrado();
      const productos = await tx
        .selectFrom('productos')
        .select(['id', 'variante', 'color', 'precio', 'stock_actual', 'stock_minimo', 'activo'])
        .where('grupo_id', '=', id)
        .orderBy('variante')
        .execute();
      const codigos = productos.length
        ? await tx
            .selectFrom('codigos_barra')
            .select(['producto_id', 'codigo'])
            .where(
              'producto_id',
              'in',
              productos.map((p) => p.id),
            )
            .execute()
        : [];
      return {
        ...g,
        variantes: productos.map((p) => ({
          id: p.id,
          variante: p.variante,
          color: p.color,
          precio: p.precio,
          stock: Number(p.stock_actual),
          minimo: Number(p.stock_minimo),
          activo: p.activo,
          codigos: codigos.filter((c) => c.producto_id === p.id).map((c) => c.codigo),
        })),
      };
    });
  });

  // Alta de un producto con todas sus variantes, con el mismo precio y la misma categoría.
  app.post('/api/v1/grupos-variantes', { config: { roles: EDITAN } }, async (req) => {
    const d = validar(
      z.strictObject({
        nombre: nombreGrupo,
        tipo: z.enum(TIPOS),
        precio: datosProducto.shape.precio,
        costo: datosProducto.shape.costo,
        categoriaId: datosProducto.shape.categoriaId,
        minimo: datosProducto.shape.minimo,
        variantes: z.array(variante).min(1).max(60),
      }),
      req.body,
    );
    const nombres = d.variantes.map((v) => v.variante.toLowerCase());
    if (new Set(nombres).size !== nombres.length)
      throw new ErrorPublico(400, 'datos_invalidos', 'Hay dos variantes con el mismo nombre.');
    const id = uuidv7();
    await req.db(async (tx) => {
      await tx
        .insertInto('grupos_variantes')
        .values({ id, kiosco_id: req.completa.kioscoId, nombre: d.nombre, tipo: d.tipo })
        .execute();
      for (const v of d.variantes) {
        await crearProducto(
          tx,
          req.completa,
          uuidv7(),
          {
            nombre: nombreDe(d.nombre, v.variante),
            precio: d.precio,
            costo: d.costo,
            categoriaId: d.categoriaId,
            minimo: d.minimo,
            stockInicial: v.stockInicial,
            codigos: v.codigo ? [v.codigo] : [],
            color: v.color ?? null,
          },
          { grupoId: id, variante: v.variante },
        );
      }
    });
    return { id };
  });

  // Renombrar el grupo renombra sus variantes ("Esmalte cremoso Rojo").
  app.patch('/api/v1/grupos-variantes/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      z.strictObject({ nombre: nombreGrupo.optional(), tipo: z.enum(TIPOS).optional() }),
      req.body,
    );
    await req.db(async (tx) => {
      const g = await tx
        .selectFrom('grupos_variantes')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!g) throw noEncontrado();
      await tx
        .updateTable('grupos_variantes')
        .set({ ...d, updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      if (d.nombre) {
        const productos = await tx
          .selectFrom('productos')
          .select(['id', 'variante'])
          .where('grupo_id', '=', id)
          .execute();
        for (const p of productos)
          await tx
            .updateTable('productos')
            .set({ nombre: nombreDe(d.nombre, p.variante ?? ''), updated_at: new Date() })
            .where('id', '=', p.id)
            .execute();
      }
    });
    return { ok: true };
  });

  // Un tono más: copia precio, costo y categoría de las otras variantes.
  app.post('/api/v1/grupos-variantes/:id/variantes', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(variante.extend({ precio: datosProducto.shape.precio.optional() }), req.body);
    const productoId = uuidv7();
    await req.db(async (tx) => {
      const g = await tx
        .selectFrom('grupos_variantes')
        .select(['id', 'nombre'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!g) throw noEncontrado();
      const modelo = await tx
        .selectFrom('productos')
        .select(['precio', 'costo', 'categoria_id', 'stock_minimo', 'variante'])
        .where('grupo_id', '=', id)
        .orderBy('activo', 'desc')
        .orderBy('created_at')
        .execute();
      if (modelo.some((m) => m.variante?.toLowerCase() === d.variante.toLowerCase()))
        throw new ErrorPublico(409, 'variante_repetida', `Ya hay una variante ${d.variante}.`);
      const m = modelo[0];
      await crearProducto(
        tx,
        req.completa,
        productoId,
        {
          nombre: nombreDe(g.nombre, d.variante),
          precio: d.precio ?? m?.precio ?? 0,
          costo: m?.costo ?? null,
          categoriaId: m?.categoria_id ?? null,
          minimo: m ? Number(m.stock_minimo) : 0,
          stockInicial: d.stockInicial,
          codigos: d.codigo ? [d.codigo] : [],
          color: d.color ?? null,
        },
        { grupoId: id, variante: d.variante },
      );
    });
    return { id: productoId };
  });
}
