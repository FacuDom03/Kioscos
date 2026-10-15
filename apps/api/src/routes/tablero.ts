// Tablero (etapa I6, docs/decisiones/009-rubros.md): qué se vende, qué no se mueve, qué falta,
// cuánto se gana por categoría, cuánto deben los clientes y qué precios están viejos.
// El costo de lo vendido se estima con el costo actual del producto (la venta no lo guarda).
import { sql } from '@mostrador/db';
import { diaArgentino, sumarDias } from '@mostrador/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validar } from '../validar.ts';

const VEN = ['dueno', 'encargado', 'soporte'] as const;
const DIA = 24 * 3600_000;

/** Medianoche de hoy en la Argentina (UTC−3, sin horario de verano). */
function inicioDeHoy(): Date {
  const fecha = new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  return new Date(`${fecha}T00:00:00-03:00`);
}

export async function rutasTablero(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/tablero', { config: { roles: VEN } }, async (req) => {
    const { periodo } = validar(
      z.strictObject({ periodo: z.enum(['hoy', '7', '30', '90']).default('30') }),
      req.query,
    );
    const hasta = new Date();
    const desde =
      periodo === 'hoy' ? inicioDeHoy() : new Date(hasta.getTime() - Number(periodo) * DIA);
    const antes = new Date(desde.getTime() - (hasta.getTime() - desde.getTime()));

    return req.db(async (tx) => {
      const totales = async (de: Date, a: Date) => {
        const r = await tx
          .selectFrom('ventas')
          .select((eb) => [
            eb.fn.coalesce(eb.fn.sum<string>('total'), sql<string>`0`).as('vendido'),
            eb.fn.countAll<string>().as('ventas'),
          ])
          .where('estado', '=', 'cobrada')
          .where('creada_en_dispositivo', '>=', de)
          .where('creada_en_dispositivo', '<', a)
          .executeTakeFirstOrThrow();
        return { vendido: Number(r.vendido), ventas: Number(r.ventas) };
      };
      const actual = await totales(desde, hasta);
      const anterior = await totales(antes, desde);
      const gremio = await tx
        .selectFrom('ventas')
        .select((eb) => [
          eb.fn.coalesce(eb.fn.sum<string>('total'), sql<string>`0`).as('vendido'),
          eb.fn.countAll<string>().as('ventas'),
        ])
        .where('estado', '=', 'cobrada')
        .where('lista', '=', 'gremio')
        .where('creada_en_dispositivo', '>=', desde)
        .executeTakeFirstOrThrow();

      // Lo que más se vende, por plata.
      const masVendidos = await tx
        .selectFrom('venta_items as i')
        .innerJoin('ventas as v', (j) =>
          j.onRef('v.id', '=', 'i.venta_id').onRef('v.kiosco_id', '=', 'i.kiosco_id'),
        )
        .innerJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'i.producto_id').onRef('p.kiosco_id', '=', 'i.kiosco_id'),
        )
        .select(['p.id', 'p.nombre', 'p.unidad'])
        .select((eb) => [
          eb.fn.sum<string>('i.subtotal').as('importe'),
          eb.fn.sum<string>('i.cantidad').as('cantidad'),
        ])
        .where('v.estado', '=', 'cobrada')
        .where('v.creada_en_dispositivo', '>=', desde)
        .groupBy(['p.id', 'p.nombre', 'p.unidad'])
        .orderBy('importe', 'desc')
        .limit(8)
        .execute();

      // Lo que no se vendió en 60 días y tiene stock: plata parada en el estante.
      const quietos = await tx
        .selectFrom('productos as p')
        .select(['p.id', 'p.nombre', 'p.unidad', 'p.stock_actual', 'p.costo'])
        .select(sql<string>`round(p.stock_actual * coalesce(p.costo, 0))`.as('capital'))
        .where('p.activo', '=', true)
        .where('p.stock_actual', '>', '0')
        .where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('venta_items as i')
                .innerJoin('ventas as v', (j) =>
                  j.onRef('v.id', '=', 'i.venta_id').onRef('v.kiosco_id', '=', 'i.kiosco_id'),
                )
                .select(sql`1`.as('x'))
                .whereRef('i.producto_id', '=', 'p.id')
                .where('v.estado', '=', 'cobrada')
                .where('v.creada_en_dispositivo', '>=', new Date(hasta.getTime() - 60 * DIA)),
            ),
          ),
        )
        .orderBy('capital', 'desc')
        .orderBy('p.nombre')
        .limit(200)
        .execute();

      const porReponer = await tx
        .selectFrom('productos')
        .select(['id', 'nombre', 'unidad', 'stock_actual', 'stock_minimo'])
        .where('activo', '=', true)
        .where('stock_minimo', '>', '0')
        .whereRef('stock_actual', '<=', 'stock_minimo')
        .orderBy(sql`stock_actual - stock_minimo`)
        .limit(10)
        .execute();
      const cuantosPorReponer = await tx
        .selectFrom('productos')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('activo', '=', true)
        .where('stock_minimo', '>', '0')
        .whereRef('stock_actual', '<=', 'stock_minimo')
        .executeTakeFirstOrThrow();

      // Ganancia por categoría: lo vendido contra el costo (actual) de lo vendido.
      const categorias = await tx
        .selectFrom('venta_items as i')
        .innerJoin('ventas as v', (j) =>
          j.onRef('v.id', '=', 'i.venta_id').onRef('v.kiosco_id', '=', 'i.kiosco_id'),
        )
        .innerJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'i.producto_id').onRef('p.kiosco_id', '=', 'i.kiosco_id'),
        )
        .leftJoin('categorias as c', (j) =>
          j.onRef('c.id', '=', 'p.categoria_id').onRef('c.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select(sql<string>`coalesce(c.nombre, 'Sin categoría')`.as('categoria'))
        .select((eb) => [
          eb.fn.sum<string>('i.subtotal').as('importe'),
          // Solo lo que tiene costo cargado entra en la cuenta de la ganancia.
          sql<string>`sum(case when p.costo is not null then i.subtotal else 0 end)`.as(
            'importe_con_costo',
          ),
          sql<string>`sum(case when p.costo is not null then round(i.cantidad * p.costo) else 0 end)`.as(
            'costo',
          ),
        ])
        .where('v.estado', '=', 'cobrada')
        .where('v.creada_en_dispositivo', '>=', desde)
        .groupBy(sql`coalesce(c.nombre, 'Sin categoría')`)
        .orderBy('importe', 'desc')
        .limit(12)
        .execute();

      const deuda = await tx
        .selectFrom('clientes as c')
        .select(
          sql<string>`coalesce((select sum(m.monto) from movimientos_cuenta m
          where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id), 0)`.as('saldo'),
        )
        .select(
          sql<boolean>`not exists (select 1 from movimientos_cuenta m
          where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id and m.tipo = 'pago'
            and m.created_at > now() - interval '30 days')`.as('sin_pagar'),
        )
        .where('c.activo', '=', true)
        .execute();
      const deudores = deuda.filter((d) => Number(d.saldo) > 0);

      const viejos = await tx
        .selectFrom('productos')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('activo', '=', true)
        .where('precio_actualizado_en', '<', new Date(hasta.getTime() - 30 * DIA))
        .executeTakeFirstOrThrow();

      // Lo que vence en los próximos 30 días (perfumería, almacén).
      const hoy = diaArgentino();
      const lotes = await tx
        .selectFrom('lotes as l')
        .innerJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'l.producto_id').onRef('p.kiosco_id', '=', 'l.kiosco_id'),
        )
        .select(['p.id', 'p.nombre', 'l.vence_en', 'l.cantidad'])
        .where('l.retirado', '=', false)
        .where('p.activo', '=', true)
        .where('l.vence_en', '<=', sumarDias(hoy, 30))
        .orderBy('l.vence_en')
        .limit(200)
        .execute();
      const promos = await tx
        .selectFrom('venta_descuentos as d')
        .innerJoin('ventas as v', (j) =>
          j.onRef('v.id', '=', 'd.venta_id').onRef('v.kiosco_id', '=', 'd.kiosco_id'),
        )
        .select((eb) => [
          eb.fn.coalesce(eb.fn.sum<string>('d.monto'), sql<string>`0`).as('monto'),
          eb.fn.count<string>('d.venta_id').distinct().as('ventas'),
        ])
        .where('v.estado', '=', 'cobrada')
        .where('v.creada_en_dispositivo', '>=', desde)
        .executeTakeFirstOrThrow();

      return {
        periodo,
        desde,
        resumen: {
          ...actual,
          ticketPromedio: actual.ventas ? Math.round(actual.vendido / actual.ventas) : 0,
          anterior: anterior.vendido,
          variacion: anterior.vendido
            ? Math.round(((actual.vendido - anterior.vendido) / anterior.vendido) * 1000) / 10
            : null,
          gremio: {
            vendido: Number(gremio.vendido),
            ticketPromedio: Number(gremio.ventas)
              ? Math.round(Number(gremio.vendido) / Number(gremio.ventas))
              : 0,
          },
        },
        masVendidos: masVendidos.map((m) => ({
          id: m.id,
          nombre: m.nombre,
          unidad: m.unidad,
          importe: Number(m.importe),
          cantidad: Number(m.cantidad),
        })),
        sinMovimiento: {
          productos: quietos.length,
          plataParada: quietos.reduce((t, q) => t + Number(q.capital), 0),
          lista: quietos.slice(0, 8).map((q) => ({
            id: q.id,
            nombre: q.nombre,
            unidad: q.unidad,
            stock: Number(q.stock_actual),
            capital: Number(q.capital),
          })),
        },
        porReponer: {
          productos: Number(cuantosPorReponer.n),
          lista: porReponer.map((p) => ({
            id: p.id,
            nombre: p.nombre,
            unidad: p.unidad,
            stock: Number(p.stock_actual),
            minimo: Number(p.stock_minimo),
          })),
        },
        categorias: categorias.map((c) => {
          const importe = Number(c.importe_con_costo);
          const costo = Number(c.costo);
          return {
            categoria: c.categoria,
            importe: Number(c.importe),
            // Ganancia sobre el costo, como en la ficha del producto.
            ganancia: costo > 0 ? Math.round(((importe - costo) / costo) * 1000) / 10 : null,
          };
        }),
        clientes: {
          deuda: deudores.reduce((t, d) => t + Number(d.saldo), 0),
          deudores: deudores.length,
          sinPagarHace30: deudores.filter((d) => d.sin_pagar).length,
        },
        preciosViejos: Number(viejos.n),
        porVencer: {
          lotes: lotes.length,
          vencidos: lotes.filter((l) => l.vence_en < hoy).length,
          lista: lotes.slice(0, 8).map((l) => ({
            id: l.id,
            nombre: l.nombre,
            venceEn: l.vence_en,
            cantidad: Number(l.cantidad),
          })),
        },
        promos: { descontado: Number(promos.monto), ventas: Number(promos.ventas) },
      };
    });
  });
}
