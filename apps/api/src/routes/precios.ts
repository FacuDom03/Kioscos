// Aumento masivo de precios con vista previa, registro y deshacer (sección 11).
import type { FastifyInstance } from 'fastify';
import type { TxKiosco } from '@mostrador/db';
import { aplicarAumento, uuidv7, type Redondeo } from '@mostrador/shared';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';

const ROLES = ['dueno', 'soporte'] as const;

const datosAumento = z.strictObject({
  alcance: z.enum(['todo', 'categoria', 'seleccion']),
  categoriaId: z.uuid().optional(),
  productoIds: z.array(z.uuid()).max(5000).optional(),
  porcentaje: z
    .number()
    .min(-90)
    .max(500)
    .refine((n) => Math.round(n * 100) === n * 100, 'Hasta 2 decimales'),
  redondeo: z.union([z.literal(1000), z.literal(5000), z.literal(10000)]),
});
type DatosAumento = z.infer<typeof datosAumento>;

interface Cambio {
  producto_id: string;
  nombre: string;
  antes: number;
  despues: number;
}

async function calcular(tx: TxKiosco, d: DatosAumento): Promise<Cambio[]> {
  let q = tx
    .selectFrom('productos')
    .select(['id', 'nombre', 'precio'])
    .where('activo', '=', true)
    .orderBy('nombre');
  if (d.alcance === 'categoria') {
    if (!d.categoriaId) throw new ErrorPublico(400, 'datos_invalidos', 'Elegí una categoría.');
    q = q.where('categoria_id', '=', d.categoriaId);
  }
  if (d.alcance === 'seleccion') {
    if (!d.productoIds?.length)
      throw new ErrorPublico(400, 'datos_invalidos', 'Elegí al menos un producto.');
    q = q.where('id', 'in', d.productoIds);
  }
  const productos = await q.execute();
  return productos.map((p) => ({
    producto_id: p.id,
    nombre: p.nombre,
    antes: p.precio,
    despues: aplicarAumento(p.precio, d.porcentaje, d.redondeo as Redondeo),
  }));
}

export async function rutasPrecios(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/precios/vista-previa', { config: { roles: ROLES } }, async (req) => {
    const d = validar(datosAumento, req.body);
    const cambios = await req.db((tx) => calcular(tx, d));
    return { cambios };
  });

  app.post('/api/v1/precios/aumentos', { config: { roles: ROLES } }, async (req) => {
    const d = validar(datosAumento, req.body);
    const id = uuidv7();
    const s = req.completa;
    const cambios = await req.db(async (tx) => {
      const cambios = (await calcular(tx, d)).filter((c) => c.antes !== c.despues);
      if (cambios.length === 0)
        throw new ErrorPublico(400, 'sin_cambios', 'Con ese porcentaje no cambia ningún precio.');
      for (const c of cambios) {
        await tx
          .updateTable('productos')
          .set({ precio: c.despues, updated_at: new Date() })
          .where('id', '=', c.producto_id)
          .execute();
      }
      await tx
        .insertInto('cambios_precio')
        .values({
          id,
          kiosco_id: s.kioscoId,
          usuario_id: s.usuarioId,
          alcance: d.alcance,
          categoria_id: d.alcance === 'categoria' ? (d.categoriaId ?? null) : null,
          porcentaje: d.porcentaje,
          redondeo: d.redondeo,
          detalle: JSON.stringify(
            cambios.map(({ producto_id, antes, despues }) => ({ producto_id, antes, despues })),
          ),
        })
        .execute();
      await auditar(
        tx,
        s,
        'precios.aumento',
        { id, porcentaje: d.porcentaje, productos: cambios.length },
        req.ip,
      );
      return cambios;
    });
    return { id, productos: cambios.length };
  });

  app.get('/api/v1/precios/aumentos', { config: { roles: ROLES } }, async (req) =>
    req.db(async (tx) => {
      const filas = await tx
        .selectFrom('cambios_precio as c')
        .leftJoin('usuarios as u', 'u.id', 'c.usuario_id')
        .leftJoin('categorias as cat', (j) =>
          j.onRef('cat.id', '=', 'c.categoria_id').onRef('cat.kiosco_id', '=', 'c.kiosco_id'),
        )
        .select([
          'c.id',
          'c.alcance',
          'c.porcentaje',
          'c.redondeo',
          'c.detalle',
          'c.deshecho_en',
          'c.created_at',
          'u.nombre',
          'cat.nombre as categoria',
        ])
        .orderBy('c.created_at', 'desc')
        .limit(30)
        .execute();
      return filas.map(({ detalle, ...f }) => ({
        ...f,
        porcentaje: Number(f.porcentaje),
        productos: (detalle as unknown[]).length,
      }));
    }),
  );

  // Deshacer: vuelve al precio anterior solo los productos que no se tocaron después del aumento.
  app.post('/api/v1/precios/aumentos/:id/deshacer', { config: { roles: ROLES } }, async (req) => {
    const { id } = validar(z.strictObject({ id: z.uuid() }), req.params);
    validar(z.strictObject({}).optional(), req.body);
    const s = req.completa;
    return req.db(async (tx) => {
      const c = await tx
        .selectFrom('cambios_precio')
        .select(['detalle', 'deshecho_en'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!c) throw noEncontrado();
      if (c.deshecho_en) throw new ErrorPublico(409, 'ya_deshecho', 'Este aumento ya se deshizo.');
      let restaurados = 0;
      let saltados = 0;
      for (const x of c.detalle as { producto_id: string; antes: number; despues: number }[]) {
        const r = await tx
          .updateTable('productos')
          .set({ precio: x.antes, updated_at: new Date() })
          .where('id', '=', x.producto_id)
          .where('precio', '=', x.despues)
          .executeTakeFirst();
        if (r.numUpdatedRows) restaurados++;
        else saltados++;
      }
      await tx
        .updateTable('cambios_precio')
        .set({ deshecho_en: new Date(), deshecho_por: s.usuarioId })
        .where('id', '=', id)
        .execute();
      await auditar(tx, s, 'precios.deshacer', { id, restaurados, saltados }, req.ip);
      return { restaurados, saltados };
    });
  });
}
