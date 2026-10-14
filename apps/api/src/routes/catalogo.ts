// Catálogo y stock (sección 11 de docs/SPEC.md). Editar el catálogo requiere conexión.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TxKiosco } from '@mostrador/db';
import { leerCsv, parsearPesos, uuidv7 } from '@mostrador/shared';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { moverStock, tipoDeCodigo } from '../servicios/stock.ts';
import { validar } from '../validar.ts';

const TODOS = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const EDITAN = ['dueno', 'encargado', 'soporte'] as const;

const centavos = z.number().int().min(0).max(100_000_000_000);
const cantidad = z.number().finite().min(-1_000_000).max(1_000_000);
const codigo = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z\-.]{1,48}$/, 'Código inválido');
const idParam = z.strictObject({ id: z.uuid() });

const verCostos = (req: FastifyRequest) => req.completa.rol !== 'cajero';

function codigoRepetido(error: unknown): never {
  const e = error as { code?: string; constraint?: string };
  if (e.code === '23505' && e.constraint === 'codigos_barra_kiosco_id_codigo_key') {
    throw new ErrorPublico(
      409,
      'codigo_repetido',
      'Ese código de barras ya está cargado en otro producto.',
    );
  }
  if (e.code === '23503') throw noEncontrado();
  throw error;
}

async function verificarCategoria(tx: TxKiosco, categoriaId: string | null | undefined) {
  if (!categoriaId) return;
  const c = await tx
    .selectFrom('categorias')
    .select('id')
    .where('id', '=', categoriaId)
    .executeTakeFirst();
  if (!c) throw noEncontrado();
}

export async function rutasCatalogo(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------- catálogo para el equipo
  // Lo que el equipo guarda para vender (también sin conexión). El cajero no recibe costos.
  app.get('/api/v1/catalogo', { config: { roles: TODOS } }, async (req) =>
    req.db(async (tx) => {
      const [productos, codigos, categorias, masVendidos] = await Promise.all([
        tx
          .selectFrom('productos')
          .select([
            'id',
            'nombre',
            'precio',
            'costo',
            'categoria_id',
            'stock_actual',
            'stock_minimo',
          ])
          .where('activo', '=', true)
          .orderBy('nombre')
          .execute(),
        tx.selectFrom('codigos_barra').select(['producto_id', 'codigo']).execute(),
        tx
          .selectFrom('categorias')
          .select(['id', 'nombre', 'orden'])
          .orderBy('orden')
          .orderBy('nombre')
          .execute(),
        tx
          .selectFrom('venta_items as i')
          .innerJoin('ventas as v', (j) =>
            j.onRef('v.id', '=', 'i.venta_id').onRef('v.kiosco_id', '=', 'i.kiosco_id'),
          )
          .select(['i.producto_id'])
          .select((eb) => eb.fn.sum<string>('i.cantidad').as('total'))
          .where('i.producto_id', 'is not', null)
          .where('v.estado', '=', 'cobrada')
          .where('v.creada_en_dispositivo', '>', new Date(Date.now() - 30 * 24 * 3600_000))
          .groupBy('i.producto_id')
          .orderBy('total', 'desc')
          .limit(23)
          .execute(),
      ]);
      const porProducto = new Map<string, string[]>();
      for (const c of codigos)
        porProducto.set(c.producto_id, [...(porProducto.get(c.producto_id) ?? []), c.codigo]);
      const conCostos = verCostos(req);
      return {
        generado: new Date().toISOString(),
        productos: productos.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          precio: p.precio,
          ...(conCostos ? { costo: p.costo } : {}),
          categoriaId: p.categoria_id,
          stock: Number(p.stock_actual),
          minimo: Number(p.stock_minimo),
          codigos: porProducto.get(p.id) ?? [],
        })),
        categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre })),
        masVendidos: masVendidos.map((m) => m.producto_id).filter((x): x is string => !!x),
      };
    }),
  );

  // ------------------------------------------------------------- categorías
  app.post('/api/v1/categorias', { config: { roles: EDITAN } }, async (req) => {
    const { nombre } = validar(
      z.strictObject({ nombre: z.string().trim().min(1).max(60) }),
      req.body,
    );
    const id = uuidv7();
    await req.db(async (tx) => {
      const { max } = await tx
        .selectFrom('categorias')
        .select((eb) => eb.fn.max<number>('orden').as('max'))
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('categorias')
        .values({ id, kiosco_id: req.completa.kioscoId, nombre, orden: (max ?? 0) + 1 })
        .execute();
    });
    return { id, nombre };
  });

  app.patch('/api/v1/categorias/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      z.strictObject({
        nombre: z.string().trim().min(1).max(60).optional(),
        orden: z.number().int().min(0).max(10_000).optional(),
      }),
      req.body,
    );
    await req.db(async (tx) => {
      const r = await tx
        .updateTable('categorias')
        .set({ ...d, updated_at: new Date() })
        .where('id', '=', id)
        .executeTakeFirst();
      if (!r.numUpdatedRows) throw noEncontrado();
    });
    return { ok: true };
  });

  app.delete('/api/v1/categorias/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    await req.db(async (tx) => {
      const c = await tx
        .selectFrom('categorias')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!c) throw noEncontrado();
      // Los productos quedan sin categoría; el historial de aumentos se conserva.
      await tx
        .updateTable('productos')
        .set({ categoria_id: null, updated_at: new Date() })
        .where('categoria_id', '=', id)
        .execute();
      const enAumentos = await tx
        .selectFrom('cambios_precio')
        .select('id')
        .where('categoria_id', '=', id)
        .executeTakeFirst();
      if (enAumentos)
        throw new ErrorPublico(
          409,
          'en_uso',
          'Esta categoría figura en un aumento de precios. Cambiale el nombre en lugar de borrarla.',
        );
      await tx.deleteFrom('categorias').where('id', '=', id).execute();
    });
    return { ok: true };
  });

  // ------------------------------------------------------------- productos
  app.get('/api/v1/productos', { config: { roles: TODOS } }, async (req) => {
    const { filtro } = validar(
      z.strictObject({ filtro: z.enum(['todos', 'por_reponer']).default('todos') }),
      req.query,
    );
    return req.db(async (tx) => {
      let q = tx
        .selectFrom('productos as p')
        .leftJoin('categorias as c', (j) =>
          j.onRef('c.id', '=', 'p.categoria_id').onRef('c.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select([
          'p.id',
          'p.nombre',
          'p.precio',
          'p.costo',
          'p.categoria_id',
          'c.nombre as categoria',
          'p.stock_actual',
          'p.stock_minimo',
          'p.activo',
        ])
        .where('p.activo', '=', true)
        .orderBy('p.nombre');
      if (filtro === 'por_reponer') q = q.whereRef('p.stock_actual', '<=', 'p.stock_minimo');
      const filas = await q.execute();
      const conteo = await tx
        .selectFrom('productos')
        .select((eb) => [
          eb.fn.countAll<string>().as('todos'),
          eb.fn
            .count<string>(
              eb.case().when('stock_actual', '<=', eb.ref('stock_minimo')).then(1).end(),
            )
            .as('por_reponer'),
        ])
        .where('activo', '=', true)
        .executeTakeFirstOrThrow();
      const conCostos = verCostos(req);
      return {
        conteo: { todos: Number(conteo.todos), porReponer: Number(conteo.por_reponer) },
        productos: filas.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          precio: p.precio,
          ...(conCostos ? { costo: p.costo } : {}),
          categoriaId: p.categoria_id,
          categoria: p.categoria,
          stock: Number(p.stock_actual),
          minimo: Number(p.stock_minimo),
        })),
      };
    });
  });

  app.get('/api/v1/productos/:id', { config: { roles: TODOS } }, async (req) => {
    const { id } = validar(idParam, req.params);
    return req.db(async (tx) => {
      const p = await tx
        .selectFrom('productos')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      const codigos = await tx
        .selectFrom('codigos_barra')
        .select(['codigo', 'tipo'])
        .where('producto_id', '=', id)
        .execute();
      const movimientos = await tx
        .selectFrom('movimientos_stock as m')
        .leftJoin('usuarios as u', 'u.id', 'm.usuario_id')
        .select(['m.id', 'm.tipo', 'm.cantidad', 'm.motivo', 'm.created_at', 'u.nombre'])
        .where('m.producto_id', '=', id)
        .orderBy('m.created_at', 'desc')
        .limit(30)
        .execute();
      return {
        id: p.id,
        nombre: p.nombre,
        precio: p.precio,
        ...(verCostos(req) ? { costo: p.costo } : {}),
        categoriaId: p.categoria_id,
        stock: Number(p.stock_actual),
        minimo: Number(p.stock_minimo),
        activo: p.activo,
        codigos: codigos.map((c) => c.codigo),
        movimientos: movimientos.map((m) => ({ ...m, cantidad: Number(m.cantidad) })),
      };
    });
  });

  const datosProducto = z.strictObject({
    nombre: z.string().trim().min(1).max(120),
    precio: centavos,
    costo: centavos.nullable().optional(),
    categoriaId: z.uuid().nullable().optional(),
    minimo: z.number().min(0).max(1_000_000).optional(),
    stockInicial: cantidad.optional(),
    codigos: z.array(codigo).max(10).optional(),
  });

  app.post('/api/v1/productos', { config: { roles: EDITAN } }, async (req) => {
    const d = validar(datosProducto, req.body);
    const id = uuidv7();
    await req.db(async (tx) => {
      await verificarCategoria(tx, d.categoriaId);
      await tx
        .insertInto('productos')
        .values({
          id,
          kiosco_id: req.completa.kioscoId,
          nombre: d.nombre,
          precio: d.precio,
          costo: d.costo ?? null,
          categoria_id: d.categoriaId ?? null,
          stock_minimo: d.minimo ?? 0,
        })
        .execute();
      for (const c of new Set(d.codigos ?? [])) {
        await tx
          .insertInto('codigos_barra')
          .values({
            id: uuidv7(),
            kiosco_id: req.completa.kioscoId,
            producto_id: id,
            codigo: c,
            tipo: tipoDeCodigo(c),
          })
          .execute()
          .catch(codigoRepetido);
      }
      if (d.stockInicial) {
        await moverStock(tx, {
          kioscoId: req.completa.kioscoId,
          productoId: id,
          tipo: 'ajuste',
          cantidad: d.stockInicial,
          usuarioId: req.completa.usuarioId,
          motivo: 'Stock inicial',
        });
      }
    });
    return { id };
  });

  app.patch('/api/v1/productos/:id', { config: { roles: EDITAN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    const d = validar(
      datosProducto
        .omit({ stockInicial: true })
        .partial()
        .extend({ activo: z.boolean().optional() })
        .strict(),
      req.body,
    );
    await req.db(async (tx) => {
      const p = await tx
        .selectFrom('productos')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      await verificarCategoria(tx, d.categoriaId);
      await tx
        .updateTable('productos')
        .set({
          ...(d.nombre !== undefined ? { nombre: d.nombre } : {}),
          ...(d.precio !== undefined ? { precio: d.precio } : {}),
          ...(d.costo !== undefined ? { costo: d.costo } : {}),
          ...(d.categoriaId !== undefined ? { categoria_id: d.categoriaId } : {}),
          ...(d.minimo !== undefined ? { stock_minimo: d.minimo } : {}),
          ...(d.activo !== undefined ? { activo: d.activo } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .execute();
      if (d.codigos) {
        const nuevos = new Set(d.codigos);
        const actuales = await tx
          .selectFrom('codigos_barra')
          .select(['id', 'codigo'])
          .where('producto_id', '=', id)
          .execute();
        const borrar = actuales.filter((c) => !nuevos.has(c.codigo)).map((c) => c.id);
        if (borrar.length) await tx.deleteFrom('codigos_barra').where('id', 'in', borrar).execute();
        const existentes = new Set(actuales.map((c) => c.codigo));
        for (const c of nuevos) {
          if (existentes.has(c)) continue;
          await tx
            .insertInto('codigos_barra')
            .values({
              id: uuidv7(),
              kiosco_id: req.completa.kioscoId,
              producto_id: id,
              codigo: c,
              tipo: tipoDeCodigo(c),
            })
            .execute()
            .catch(codigoRepetido);
        }
      }
    });
    return { ok: true };
  });

  // ------------------------------------------------------------- ajustes de stock
  app.post('/api/v1/stock/ajustes', { config: { roles: EDITAN } }, async (req) => {
    const d = validar(
      z.strictObject({
        productoId: z.uuid(),
        motivo: z.enum(['rotura', 'vencido', 'conteo', 'robo', 'otro']),
        // O una diferencia (por ejemplo -2) o lo que se contó en el estante.
        cantidad: cantidad.optional(),
        contado: z.number().min(-1_000_000).max(1_000_000).optional(),
        nota: z.string().trim().max(150).optional(),
      }),
      req.body,
    );
    if ((d.cantidad === undefined) === (d.contado === undefined))
      throw new ErrorPublico(400, 'datos_invalidos', 'Indicá la diferencia o lo que contaste.');
    return req.db(async (tx) => {
      const p = await tx
        .selectFrom('productos')
        .select(['stock_actual'])
        .where('id', '=', d.productoId)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      const delta = d.cantidad ?? (d.contado ?? 0) - Number(p.stock_actual);
      if (delta === 0) return { stock: Number(p.stock_actual) };
      const motivos = {
        rotura: 'Rotura',
        vencido: 'Vencido',
        conteo: 'Conteo',
        robo: 'Faltante',
        otro: 'Otro',
      } as const;
      const r = await moverStock(tx, {
        kioscoId: req.completa.kioscoId,
        productoId: d.productoId,
        tipo: 'ajuste',
        cantidad: delta,
        usuarioId: req.completa.usuarioId,
        motivo: d.nota ? `${motivos[d.motivo]}: ${d.nota}` : motivos[d.motivo],
      });
      return { stock: r.stockNuevo };
    });
  });

  // ------------------------------------------------------------- importar CSV
  // Columnas (en cualquier orden, con encabezado): nombre, precio, codigo, categoria, costo, stock, minimo.
  app.post(
    '/api/v1/productos/importar',
    { config: { roles: EDITAN }, bodyLimit: 2 * 1024 * 1024 },
    async (req) => {
      const { csv } = validar(z.strictObject({ csv: z.string().min(1).max(2_000_000) }), req.body);
      const filas = leerCsv(csv);
      const encabezado = (filas.shift() ?? []).map((h) =>
        h.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
      );
      const col = (n: string) => encabezado.indexOf(n);
      const iNombre = col('nombre');
      const iPrecio = col('precio');
      if (iNombre < 0 || iPrecio < 0)
        throw new ErrorPublico(
          400,
          'csv',
          'El archivo tiene que tener las columnas "nombre" y "precio".',
        );
      if (filas.length > 5000)
        throw new ErrorPublico(400, 'csv', 'Como máximo 5000 productos por archivo.');
      const iCodigo = col('codigo');
      const iCategoria = col('categoria');
      const iCosto = col('costo');
      const iStock = col('stock');
      const iMinimo = col('minimo');

      const resultado = {
        creados: 0,
        actualizados: 0,
        errores: [] as { linea: number; motivo: string }[],
      };
      await req.db(async (tx) => {
        const kioscoId = req.completa.kioscoId;
        const categorias = new Map(
          (await tx.selectFrom('categorias').select(['id', 'nombre']).execute()).map((c) => [
            c.nombre.toLowerCase(),
            c.id,
          ]),
        );
        const codigos = new Map(
          (await tx.selectFrom('codigos_barra').select(['codigo', 'producto_id']).execute()).map(
            (c) => [c.codigo, c.producto_id],
          ),
        );
        for (const [n, f] of filas.entries()) {
          const linea = n + 2;
          const nombre = f[iNombre]?.trim() ?? '';
          const precio = parsearPesos(f[iPrecio] ?? '');
          const cod = iCodigo >= 0 ? (f[iCodigo]?.trim() ?? '') : '';
          if (!nombre || nombre.length > 120) {
            resultado.errores.push({ linea, motivo: 'Falta el nombre' });
            continue;
          }
          if (precio === null) {
            resultado.errores.push({ linea, motivo: 'Precio inválido' });
            continue;
          }
          if (cod && !/^[0-9A-Za-z\-.]{1,48}$/.test(cod)) {
            resultado.errores.push({ linea, motivo: 'Código inválido' });
            continue;
          }
          const costo = iCosto >= 0 && f[iCosto]?.trim() ? parsearPesos(f[iCosto] ?? '') : null;
          const stock = iStock >= 0 ? Number((f[iStock] ?? '').replace(',', '.')) || 0 : 0;
          const minimo = iMinimo >= 0 ? Number((f[iMinimo] ?? '').replace(',', '.')) || 0 : 0;
          let categoriaId: string | null = null;
          const nombreCat = iCategoria >= 0 ? (f[iCategoria]?.trim() ?? '') : '';
          if (nombreCat) {
            categoriaId = categorias.get(nombreCat.toLowerCase()) ?? null;
            if (!categoriaId) {
              categoriaId = uuidv7();
              await tx
                .insertInto('categorias')
                .values({
                  id: categoriaId,
                  kiosco_id: kioscoId,
                  nombre: nombreCat.slice(0, 60),
                  orden: categorias.size + 1,
                })
                .execute();
              categorias.set(nombreCat.toLowerCase(), categoriaId);
            }
          }
          const existente = cod ? codigos.get(cod) : undefined;
          if (existente) {
            await tx
              .updateTable('productos')
              .set({
                nombre,
                precio,
                ...(costo !== null ? { costo } : {}),
                ...(categoriaId ? { categoria_id: categoriaId } : {}),
                ...(iMinimo >= 0 ? { stock_minimo: minimo } : {}),
                updated_at: new Date(),
              })
              .where('id', '=', existente)
              .execute();
            resultado.actualizados++;
            continue;
          }
          const id = uuidv7();
          await tx
            .insertInto('productos')
            .values({
              id,
              kiosco_id: kioscoId,
              nombre,
              precio,
              costo,
              categoria_id: categoriaId,
              stock_minimo: minimo,
            })
            .execute();
          if (cod) {
            await tx
              .insertInto('codigos_barra')
              .values({
                id: uuidv7(),
                kiosco_id: kioscoId,
                producto_id: id,
                codigo: cod,
                tipo: tipoDeCodigo(cod),
              })
              .execute();
            codigos.set(cod, id);
          }
          if (stock)
            await moverStock(tx, {
              kioscoId,
              productoId: id,
              tipo: 'ajuste',
              cantidad: stock,
              usuarioId: req.completa.usuarioId,
              motivo: 'Importación',
            });
          resultado.creados++;
        }
        await auditar(
          tx,
          req.completa,
          'catalogo.importacion',
          { creados: resultado.creados, actualizados: resultado.actualizados },
          req.ip,
        );
      });
      return resultado;
    },
  );
}
