// Presupuestos (etapa I4, docs/decisiones/009-rubros.md). Se arman desde el ticket, se mandan
// por WhatsApp o se imprimen, y pasan a venta sin cargar nada de nuevo.
import type { TxKiosco } from '@mostrador/db';
import { UNIDADES, subtotal, uuidv7 } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ErrorPublico, noEncontrado } from '../errores.ts';
import { validar } from '../validar.ts';

const VENDEN = ['dueno', 'encargado', 'cajero', 'soporte'] as const;
const centavos = z.number().int().min(0).max(100_000_000_000);
const idParam = z.strictObject({ id: z.uuid() });

const esquemaPresupuesto = z.strictObject({
  id: z.uuid(),
  lista: z.enum(['mostrador', 'gremio']).optional(),
  para: z.string().trim().min(1).max(80).optional(),
  nota: z.string().trim().min(1).max(300).optional(),
  venceEn: z.iso.date(),
  total: centavos,
  items: z
    .array(
      z.strictObject({
        productoId: z.uuid().nullable(),
        descripcion: z.string().trim().min(1).max(120),
        cantidad: z.number().positive().max(100_000),
        unidad: z.enum(UNIDADES).optional(),
        precioUnitario: centavos,
      }),
    )
    .min(1)
    .max(300),
});

/** Fecha de hoy en la Argentina (AAAA-MM-DD): a la noche, en UTC ya es mañana. */
const fechaArgentina = (d: Date) =>
  d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const hoy = () => fechaArgentina(new Date());

/** "vencido" no se guarda: es un presupuesto abierto cuya fecha ya pasó. */
const estadoVisible = (estado: string, venceEn: string) =>
  estado === 'abierto' && venceEn < hoy() ? 'vencido' : estado;

async function buscar(tx: TxKiosco, id: string) {
  const p = await tx
    .selectFrom('presupuestos as p')
    .leftJoin('usuarios as u', 'u.id', 'p.usuario_id')
    .select([
      'p.id',
      'p.numero',
      'p.lista',
      'p.para',
      'p.nota',
      'p.total',
      'p.estado',
      'p.vence_en',
      'p.venta_id',
      'p.created_at',
      'u.nombre as hecho_por',
    ])
    .where('p.id', '=', id)
    .executeTakeFirst();
  if (!p) throw noEncontrado();
  const items = await tx
    .selectFrom('presupuesto_items')
    .select([
      'id',
      'producto_id',
      'descripcion',
      'cantidad',
      'unidad',
      'precio_unitario',
      'subtotal',
    ])
    .where('presupuesto_id', '=', id)
    .orderBy('id')
    .execute();
  return {
    id: p.id,
    numero: p.numero,
    lista: p.lista,
    para: p.para,
    nota: p.nota,
    total: p.total,
    estado: estadoVisible(p.estado, p.vence_en),
    venceEn: p.vence_en,
    ventaId: p.venta_id,
    creadoEn: p.created_at,
    hechoPor: p.hecho_por,
    items: items.map((i) => ({
      id: i.id,
      productoId: i.producto_id,
      descripcion: i.descripcion,
      cantidad: Number(i.cantidad),
      unidad: i.unidad,
      precioUnitario: i.precio_unitario,
      subtotal: i.subtotal,
    })),
  };
}

export async function rutasPresupuestos(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/presupuestos', { config: { roles: VENDEN } }, async (req) => {
    const d = validar(esquemaPresupuesto, req.body);
    const s = req.completa;
    if (d.items.reduce((t, i) => t + subtotal(i.cantidad, i.precioUnitario), 0) !== d.total)
      throw new ErrorPublico(400, 'datos_invalidos', 'El total no coincide con los productos.');
    const maximo = fechaArgentina(new Date(Date.now() + 366 * 24 * 3600_000));
    if (d.venceEn < hoy() || d.venceEn > maximo)
      throw new ErrorPublico(400, 'datos_invalidos', 'La fecha de validez no es válida.');
    return req.db(async (tx) => {
      // Guardarlo dos veces (un reintento) no lo duplica. Se mira después de tomar el número:
      // dos reintentos a la vez esperan uno al otro y el segundo encuentra el primero.
      await tx.selectFrom('kioscos').select('id').forUpdate().execute();
      const ya = await tx
        .selectFrom('presupuestos')
        .select(['id', 'numero'])
        .where('id', '=', d.id)
        .executeTakeFirst();
      if (ya) return ya;
      const ids = [...new Set(d.items.map((i) => i.productoId).filter((x): x is string => !!x))];
      if (
        ids.length &&
        (await tx.selectFrom('productos').select('id').where('id', 'in', ids).execute()).length !==
          ids.length
      )
        throw noEncontrado();
      // El número es correlativo por comercio: se toma de a uno (con el bloqueo de arriba).
      const ultimo = await tx
        .selectFrom('presupuestos')
        .select((eb) => eb.fn.max('numero').as('n'))
        .executeTakeFirst();
      const numero = (ultimo?.n ?? 0) + 1;
      await tx
        .insertInto('presupuestos')
        .values({
          id: d.id,
          kiosco_id: s.kioscoId,
          numero,
          usuario_id: s.usuarioId,
          lista: d.lista ?? 'mostrador',
          para: d.para ?? null,
          nota: d.nota ?? null,
          total: d.total,
          vence_en: d.venceEn,
        })
        .execute();
      await tx
        .insertInto('presupuesto_items')
        .values(
          d.items.map((i) => ({
            id: uuidv7(),
            kiosco_id: s.kioscoId,
            presupuesto_id: d.id,
            producto_id: i.productoId,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            unidad: i.unidad ?? 'unidad',
            precio_unitario: i.precioUnitario,
            subtotal: subtotal(i.cantidad, i.precioUnitario),
          })),
        )
        .execute();
      return { id: d.id, numero };
    });
  });

  app.get('/api/v1/presupuestos', { config: { roles: VENDEN } }, async (req) => {
    const { estado } = validar(
      z.strictObject({ estado: z.enum(['abiertos', 'todos']).default('abiertos') }),
      req.query,
    );
    return req.db(async (tx) => {
      let q = tx
        .selectFrom('presupuestos as p')
        .select((eb) => [
          'p.id',
          'p.numero',
          'p.para',
          'p.total',
          'p.estado',
          'p.vence_en',
          'p.created_at',
          eb
            .selectFrom('presupuesto_items as i')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('i.presupuesto_id', '=', 'p.id')
            .as('renglones'),
        ])
        .orderBy('p.numero', 'desc')
        .limit(200);
      if (estado === 'abiertos') q = q.where('p.estado', '=', 'abierto');
      const filas = await q.execute();
      return filas.map((f) => ({
        id: f.id,
        numero: f.numero,
        para: f.para,
        total: f.total,
        estado: estadoVisible(f.estado, f.vence_en),
        venceEn: f.vence_en,
        creadoEn: f.created_at,
        renglones: Number(f.renglones ?? 0),
      }));
    });
  });

  app.get('/api/v1/presupuestos/:id', { config: { roles: VENDEN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    return req.db((tx) => buscar(tx, id));
  });

  app.post('/api/v1/presupuestos/:id/anular', { config: { roles: VENDEN } }, async (req) => {
    const { id } = validar(idParam, req.params);
    validar(z.strictObject({}).optional(), req.body);
    return req.db(async (tx) => {
      const p = await buscar(tx, id);
      if (p.estado === 'vendido' || p.estado === 'anulado')
        throw new ErrorPublico(409, 'cerrado', 'Ese presupuesto ya está cerrado.');
      await tx
        .updateTable('presupuestos')
        .set({ estado: 'anulado', updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      return { ok: true };
    });
  });
}
