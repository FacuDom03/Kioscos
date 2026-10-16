// Proveedores y actualización de precios con su lista (etapa I3, docs/decisiones/009-rubros.md).
// La planilla se lee en el equipo; acá llegan los renglones (código, descripción, precio). El
// servidor cruza, calcula y aplica: nunca usa precios calculados por el equipo.
import { sql, type TxKiosco } from '@mostrador/db';
import { redondearPrecio, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { validar } from '../validar.ts';
import { exigirModulo } from '../servicios/negocio.ts';

const EDITAN = ['dueno', 'encargado', 'soporte'] as const;
// Igual que el aumento masivo: cambiar muchos precios de una vez es cosa del dueño.
const ACTUALIZAN = ['dueno', 'soporte'] as const;

const centavos = z.number().int().min(0).max(100_000_000_000);
const porcentaje = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((n) => Math.round(n * 100) === n * 100, 'Hasta 2 decimales');
const idParam = z.strictObject({ id: z.uuid() });
const codigoProveedor = z.string().trim().min(1).max(60);

export const esquemaOpciones = z.strictObject({
  /** Bonificación del proveedor sobre su precio de lista. */
  descuento: porcentaje(0, 90),
  /** La lista viene sin IVA: se suma el 21 % al costo. */
  iva: z.boolean(),
  /** `mantener`: el precio sube o baja lo mismo que el costo. `ganancia`: costo + ganancia. */
  calculo: z.enum(['mantener', 'ganancia']),
  /** Ganancia sobre el costo (para `ganancia` y para productos sin costo anterior). */
  ganancia: porcentaje(0, 1000),
  redondeo: z.union([z.literal(100), z.literal(1000), z.literal(5000), z.literal(10000)]),
  gremio: z.enum(['no', 'mantener', 'ganancia']),
  gananciaGremio: porcentaje(0, 1000),
  /** Dónde están el código, la descripción y el precio en la planilla de este proveedor. Se
   * guarda con la lista para leer igual la próxima, aunque los títulos no se entiendan solos. */
  columnas: z
    .strictObject({
      encabezado: z.int().min(0).max(29),
      codigo: z.int().min(0).max(199),
      descripcion: z.int().min(-1).max(199),
      precio: z.int().min(0).max(199),
    })
    .optional(),
});
type Opciones = z.infer<typeof esquemaOpciones>;

const esquemaLista = z.strictObject({
  renglones: z
    .array(
      z.strictObject({
        codigo: codigoProveedor,
        descripcion: z.string().trim().max(120),
        // Un renglón sin precio no sirve para calcular nada (la app ya lo descarta).
        costo: centavos.refine((n) => n > 0),
      }),
    )
    .min(1)
    .max(20_000),
  opciones: esquemaOpciones,
  /** Renglones que la persona vinculó a mano con un producto. */
  vincular: z
    .array(z.strictObject({ codigo: codigoProveedor, productoId: z.uuid() }))
    .max(5000)
    .optional(),
});
type DatosLista = z.infer<typeof esquemaLista>;

const esquemaAplicar = esquemaLista.extend({
  archivo: z.string().trim().max(120).optional(),
  /** Códigos de renglones sin producto que se cargan como productos nuevos. */
  crear: z.array(codigoProveedor).max(5000).optional(),
});

export interface CambioLista {
  productoId: string;
  nombre: string;
  codigo: string;
  vinculo: 'proveedor' | 'barras' | 'manual';
  costoAntes: number | null;
  costo: number;
  precioAntes: number;
  precio: number;
  gremioAntes: number | null;
  gremio: number | null;
  /** Cuánto cambió el costo, en porcentaje con un decimal (null si no había costo). */
  variacion: number | null;
  /** Cambio de costo de más del 50 %: conviene mirarlo. */
  grande: boolean;
}

interface NuevoLista {
  codigo: string;
  descripcion: string;
  costo: number;
  precio: number;
}

/** Redondea sin llegar a $ 0 ni quedar por debajo del costo. */
const redondear = (n: number, r: number, costo: number) => redondearPrecio(n, r, costo);
const conGanancia = (costo: number, g: number) =>
  Math.round((costo * (10_000 + Math.round(g * 100))) / 10_000);
const proporcional = (base: number, antes: number | null, ahora: number) =>
  antes && antes > 0 ? Math.round((base * ahora) / antes) : null;

/** Costo real: precio de lista menos la bonificación, más IVA si la lista no lo trae. */
export function costoReal(precioLista: number, o: Opciones): number {
  const bonificado = Math.round((precioLista * (10_000 - Math.round(o.descuento * 100))) / 10_000);
  return o.iva ? Math.round((bonificado * 121) / 100) : bonificado;
}

async function cruzar(tx: TxKiosco, proveedorId: string, d: DatosLista) {
  const o = d.opciones;
  const vinculos = new Map(
    (
      await tx
        .selectFrom('producto_proveedor')
        .select(['codigo', 'producto_id'])
        .where('proveedor_id', '=', proveedorId)
        .execute()
    ).map((v) => [v.codigo.toLowerCase(), v.producto_id]),
  );
  const barras = new Map(
    (await tx.selectFrom('codigos_barra').select(['codigo', 'producto_id']).execute()).map((c) => [
      c.codigo.toLowerCase(),
      c.producto_id,
    ]),
  );
  const manual = new Map((d.vincular ?? []).map((v) => [v.codigo.toLowerCase(), v.productoId]));
  const productos = new Map(
    (
      await tx
        .selectFrom('productos')
        .select(['id', 'nombre', 'precio', 'costo', 'precio_gremio'])
        .where('activo', '=', true)
        .execute()
    ).map((p) => [p.id, p]),
  );

  const cambios: CambioLista[] = [];
  const nuevos: NuevoLista[] = [];
  let repetidos = 0;
  const vistos = new Set<string>();
  const usados = new Set<string>();
  for (const r of d.renglones) {
    const clave = r.codigo.toLowerCase();
    if (vistos.has(clave)) {
      repetidos++;
      continue;
    }
    vistos.add(clave);
    const costo = costoReal(r.costo, o);
    const encontrado =
      (manual.has(clave) && { id: manual.get(clave), vinculo: 'manual' as const }) ||
      (vinculos.has(clave) && { id: vinculos.get(clave), vinculo: 'proveedor' as const }) ||
      (barras.has(clave) && { id: barras.get(clave), vinculo: 'barras' as const }) ||
      null;
    const p = encontrado?.id ? productos.get(encontrado.id) : undefined;
    if (!p || !encontrado) {
      nuevos.push({
        codigo: r.codigo,
        descripcion: r.descripcion,
        costo,
        precio: redondear(conGanancia(costo, o.ganancia), o.redondeo, costo),
      });
      continue;
    }
    if (usados.has(p.id)) {
      repetidos++;
      continue;
    }
    usados.add(p.id);
    // Manteniendo la ganancia, si el costo no cambió el precio queda como está.
    const igual = o.calculo === 'mantener' && p.costo === costo;
    const precio = igual
      ? p.precio
      : redondear(
          (o.calculo === 'mantener' ? proporcional(p.precio, p.costo, costo) : null) ??
            conGanancia(costo, o.ganancia),
          o.redondeo,
          costo,
        );
    let gremio = p.precio_gremio;
    if (o.gremio === 'ganancia')
      gremio = redondear(conGanancia(costo, o.gananciaGremio), o.redondeo, costo);
    else if (o.gremio === 'mantener' && p.precio_gremio !== null && p.costo !== costo)
      gremio = redondear(
        proporcional(p.precio_gremio, p.costo, costo) ?? conGanancia(costo, o.gananciaGremio),
        o.redondeo,
        costo,
      );
    const variacion = p.costo ? Math.round(((costo - p.costo) / p.costo) * 1000) / 10 : null;
    cambios.push({
      productoId: p.id,
      nombre: p.nombre,
      codigo: r.codigo,
      vinculo: encontrado.vinculo,
      costoAntes: p.costo,
      costo,
      precioAntes: p.precio,
      precio,
      gremioAntes: p.precio_gremio,
      gremio,
      variacion,
      grande: variacion !== null && Math.abs(variacion) > 50,
    });
  }
  const cambia = (c: CambioLista) =>
    c.costo !== c.costoAntes || c.precio !== c.precioAntes || c.gremio !== c.gremioAntes;
  return {
    cambios,
    nuevos,
    resumen: {
      renglones: d.renglones.length,
      encontrados: cambios.length,
      suben: cambios.filter((c) => c.costoAntes !== null && c.costo > c.costoAntes).length,
      bajan: cambios.filter((c) => c.costoAntes !== null && c.costo < c.costoAntes).length,
      cambian: cambios.filter(cambia).length,
      nuevos: nuevos.length,
      repetidos,
      grandes: cambios.filter((c) => c.grande).length,
    },
    cambia,
  };
}

async function proveedorDelKiosco(tx: TxKiosco, id: string) {
  const p = await tx
    .selectFrom('proveedores')
    .select(['id', 'nombre'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!p) throw noEncontrado();
  return p;
}

function nombreRepetido(error: unknown): never {
  const e = error as { code?: string };
  if (e.code === '23505')
    throw new ErrorPublico(409, 'repetido', 'Ya tenés un proveedor con ese nombre.');
  throw error;
}

export async function rutasProveedores(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/proveedores', { config: { roles: EDITAN } }, async (req) =>
    req.db(async (tx) => {
      const filas = await tx
        .selectFrom('proveedores as p')
        .select((eb) => [
          'p.id',
          'p.nombre',
          eb
            .selectFrom('producto_proveedor as pp')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('pp.proveedor_id', '=', 'p.id')
            .as('productos'),
          eb
            .selectFrom('listas_proveedor as l')
            .select((e) => e.fn.max('l.created_at').as('ultima'))
            .whereRef('l.proveedor_id', '=', 'p.id')
            .as('ultimaLista'),
        ])
        .where('p.activo', '=', true)
        .orderBy('p.nombre')
        .execute();
      return filas.map((f) => ({ ...f, productos: Number(f.productos ?? 0) }));
    }),
  );

  app.post('/api/v1/proveedores', { config: { roles: EDITAN } }, async (req) => {
    const { nombre } = validar(
      z.strictObject({ nombre: z.string().trim().min(1).max(80) }),
      req.body,
    );
    const id = uuidv7();
    await req.db((tx) =>
      tx
        .insertInto('proveedores')
        .values({ id, kiosco_id: req.completa.kioscoId, nombre })
        .execute()
        .catch(nombreRepetido),
    );
    return { id };
  });

  app.patch('/api/v1/proveedores/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      z.strictObject({
        nombre: z.string().trim().min(1).max(80).optional(),
        activo: z.boolean().optional(),
      }),
      req.body,
    );
    await req.db(async (tx) => {
      await proveedorDelKiosco(tx, id);
      await tx
        .updateTable('proveedores')
        .set({ ...d, updated_at: new Date() })
        .where('id', '=', id)
        .execute()
        .catch(nombreRepetido);
    });
    return { ok: true };
  });

  app.post(
    '/api/v1/proveedores/:id/lista/vista-previa',
    { config: { roles: ACTUALIZAN }, bodyLimit: 4 * 1024 * 1024 },
    async (req) => {
      const { id } = validar(idParam, req.params);
      const d = validar(esquemaLista, req.body);
      return req.db(async (tx) => {
        await proveedorDelKiosco(tx, id);
        await exigirModulo(tx, 'precios_proveedor');
        const { cambios, nuevos, resumen } = await cruzar(tx, id, d);
        return { resumen, cambios, nuevos };
      });
    },
  );

  app.post(
    '/api/v1/proveedores/:id/lista/aplicar',
    { config: { roles: ACTUALIZAN }, bodyLimit: 4 * 1024 * 1024 },
    async (req) => {
      const { id } = validar(idParam, req.params);
      const d = validar(esquemaAplicar, req.body);
      const s = req.completa;
      return req.db(async (tx) => {
        const proveedor = await proveedorDelKiosco(tx, id);
        await exigirModulo(tx, 'precios_proveedor');
        const { cambios, nuevos, cambia } = await cruzar(tx, id, d);
        const ahora = new Date();
        const detalle: Record<string, unknown>[] = [];

        for (const c of cambios) {
          if (cambia(c)) {
            await tx
              .updateTable('productos')
              .set({
                costo: c.costo,
                precio: c.precio,
                precio_gremio: c.gremio,
                updated_at: ahora,
              })
              .where('id', '=', c.productoId)
              .execute();
            detalle.push({
              producto_id: c.productoId,
              costo_antes: c.costoAntes,
              costo: c.costo,
              precio_antes: c.precioAntes,
              precio: c.precio,
              gremio_antes: c.gremioAntes,
              gremio: c.gremio,
            });
          }
          // El código del proveedor queda guardado (si se encontró por código de barras o a
          // mano, la próxima lista lo encuentra solo).
          await tx
            .deleteFrom('producto_proveedor')
            .where('proveedor_id', '=', id)
            .where('codigo', '=', c.codigo)
            .where('producto_id', '<>', c.productoId)
            .execute();
          await tx
            .insertInto('producto_proveedor')
            .values({
              id: uuidv7(),
              kiosco_id: s.kioscoId,
              producto_id: c.productoId,
              proveedor_id: id,
              codigo: c.codigo,
              costo: c.costo,
              actualizado_en: ahora,
            })
            .onConflict((oc) =>
              oc
                .columns(['kiosco_id', 'proveedor_id', 'producto_id'])
                .doUpdateSet({ codigo: c.codigo, costo: c.costo, actualizado_en: ahora }),
            )
            .execute();
        }

        const crear = new Set((d.crear ?? []).map((x) => x.toLowerCase()));
        let creados = 0;
        for (const n of nuevos) {
          if (!crear.has(n.codigo.toLowerCase())) continue;
          const productoId = uuidv7();
          await tx
            .insertInto('productos')
            .values({
              id: productoId,
              kiosco_id: s.kioscoId,
              nombre: (n.descripcion || n.codigo).slice(0, 120),
              precio: n.precio,
              costo: n.costo,
            })
            .execute();
          await tx
            .insertInto('producto_proveedor')
            .values({
              id: uuidv7(),
              kiosco_id: s.kioscoId,
              producto_id: productoId,
              proveedor_id: id,
              codigo: n.codigo,
              costo: n.costo,
            })
            .execute();
          detalle.push({ producto_id: productoId, nuevo: true, costo: n.costo, precio: n.precio });
          creados++;
        }

        if (detalle.length === 0)
          throw new ErrorPublico(400, 'sin_cambios', 'Con esta lista no cambia ningún precio.');
        const listaId = uuidv7();
        await tx
          .insertInto('listas_proveedor')
          .values({
            id: listaId,
            kiosco_id: s.kioscoId,
            proveedor_id: id,
            usuario_id: s.usuarioId,
            archivo: d.archivo ?? null,
            renglones: d.renglones.length,
            opciones: JSON.stringify(d.opciones),
            detalle: JSON.stringify(detalle),
          })
          .execute();
        const cambiados = detalle.length - creados;
        await auditar(
          tx,
          s,
          'precios.proveedor',
          { id: listaId, proveedor: proveedor.nombre, cambiados, creados },
          req.ip,
        );
        return { id: listaId, cambiados, creados };
      });
    },
  );

  app.get('/api/v1/proveedores/:id/listas', { config: { roles: ACTUALIZAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    return req.db(async (tx) => {
      await proveedorDelKiosco(tx, id);
      const filas = await tx
        .selectFrom('listas_proveedor as l')
        .leftJoin('usuarios as u', 'u.id', 'l.usuario_id')
        .select([
          'l.id',
          'l.archivo',
          'l.renglones',
          'l.opciones',
          'l.detalle',
          'l.deshecha_en',
          'l.created_at',
          'u.nombre',
        ])
        .where('l.proveedor_id', '=', id)
        .orderBy('l.created_at', 'desc')
        .limit(20)
        .execute();
      return filas.map(({ detalle, ...f }) => ({
        ...f,
        productos: (detalle as unknown[]).length,
      }));
    });
  });

  // Deshacer: vuelve los precios y costos de antes solo en los productos que no se tocaron
  // después. Los productos que la lista creó quedan (pueden tener ventas).
  app.post(
    '/api/v1/listas-proveedor/:id/deshacer',
    { config: { roles: ACTUALIZAN } },
    async (req) => {
      const { id } = validar(idParam, req.params);
      validar(z.strictObject({}).optional(), req.body);
      const s = req.completa;
      return req.db(async (tx) => {
        const l = await tx
          .selectFrom('listas_proveedor')
          .select(['detalle', 'deshecha_en'])
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!l) throw noEncontrado();
        if (l.deshecha_en)
          throw new ErrorPublico(409, 'ya_deshecho', 'Esta actualización ya se deshizo.');
        let restaurados = 0;
        let saltados = 0;
        for (const x of l.detalle as {
          producto_id: string;
          nuevo?: boolean;
          costo_antes: number | null;
          precio_antes: number;
          precio: number;
          costo?: number;
          gremio_antes: number | null;
          gremio?: number | null;
        }[]) {
          if (x.nuevo) continue;
          // Solo se vuelve atrás lo que nadie tocó después (precio, costo y precio de gremio).
          let q = tx
            .updateTable('productos')
            .set({
              precio: x.precio_antes,
              costo: x.costo_antes,
              precio_gremio: x.gremio_antes,
              updated_at: new Date(),
            })
            .where('id', '=', x.producto_id)
            .where('precio', '=', x.precio);
          if (x.costo !== undefined) q = q.where('costo', '=', x.costo);
          if (x.gremio !== undefined)
            q = q.where(sql<boolean>`precio_gremio is not distinct from ${x.gremio}`);
          const r = await q.executeTakeFirst();
          if (r.numUpdatedRows) restaurados++;
          else saltados++;
        }
        await tx
          .updateTable('listas_proveedor')
          .set({ deshecha_en: new Date(), deshecha_por: s.usuarioId })
          .where('id', '=', id)
          .execute();
        await auditar(tx, s, 'precios.proveedor.deshacer', { id, restaurados, saltados }, req.ip);
        return { restaurados, saltados };
      });
    },
  );
}
