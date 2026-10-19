// API para los comercios (docs/API.md): solo lectura, con una clave de API. La clave define el
// comercio; nada del pedido puede cambiarlo. Los importes van en centavos.
import type { FastifyInstance } from 'fastify';
import { sql } from '@mostrador/db';
import { diaArgentino, sumarDias } from '@mostrador/shared';
import { z } from 'zod';
import { datosInvalidos, noEncontrado } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { datosDeVenta } from '../servicios/avisos.ts';
import { validar } from '../validar.ts';

const EXTERNA = { externa: true } as const;
const conId = z.strictObject({ id: z.uuid() });
const pagina = {
  limite: z.coerce.number().int().min(1).max(500).default(100),
  despues: z.uuid().optional(),
};
const periodo = { desde: z.iso.date().optional(), hasta: z.iso.date().optional() };

/** Del primer al último día, en la hora de la Argentina. Sin fechas: los últimos 7 días. */
function rango(desde: string | undefined, hasta: string | undefined) {
  const fin = hasta ?? diaArgentino();
  const inicio = desde ?? sumarDias(fin, -6);
  const d = new Date(`${inicio}T00:00:00-03:00`);
  const h = new Date(new Date(`${fin}T00:00:00-03:00`).getTime() + 86_400_000);
  if (h <= d) throw datosInvalidos('La fecha "hasta" tiene que ser igual o posterior a "desde".');
  if (h.getTime() - d.getTime() > 367 * 86_400_000)
    throw datosInvalidos('Pedí como mucho un año por vez.');
  return { d, h };
}

const siguiente = <T extends { id: string }>(filas: T[], limite: number) =>
  filas.length === limite ? (filas[filas.length - 1]?.id ?? null) : null;

export async function rutasExterna(app: FastifyInstance): Promise<void> {
  app.get('/api/externa/v1/negocio', { config: EXTERNA }, async (req) =>
    req.db(async (tx) => {
      const k = await tx
        .selectFrom('kioscos')
        .select(['nombre', 'rubro'])
        .executeTakeFirstOrThrow();
      return { nombre: k.nombre, rubro: k.rubro, permisos: req.clave?.permisos ?? [] };
    }),
  );

  const columnasProducto = [
    'p.id',
    'p.nombre',
    'p.precio',
    'p.costo',
    'p.precio_gremio',
    'p.stock_actual',
    'p.stock_minimo',
    'p.unidad',
    'p.activo',
    'c.nombre as categoria',
  ] as const;

  app.get('/api/externa/v1/productos', { config: EXTERNA }, async (req) => {
    const q = validar(
      z.strictObject({ ...pagina, porReponer: z.enum(['si', 'no']).optional() }),
      req.query,
    );
    return req.db(async (tx) => {
      let consulta = tx
        .selectFrom('productos as p')
        .leftJoin('categorias as c', (j) =>
          j.onRef('c.id', '=', 'p.categoria_id').onRef('c.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select(columnasProducto)
        .where('p.activo', '=', true)
        .orderBy('p.id')
        .limit(q.limite);
      if (q.despues) consulta = consulta.where('p.id', '>', q.despues);
      if (q.porReponer === 'si')
        consulta = consulta.whereRef('p.stock_actual', '<=', 'p.stock_minimo');
      const filas = await consulta.execute();
      const codigos = filas.length
        ? await tx
            .selectFrom('codigos_barra')
            .select(['producto_id', 'codigo'])
            .where(
              'producto_id',
              'in',
              filas.map((f) => f.id),
            )
            .orderBy('codigo')
            .execute()
        : [];
      return {
        datos: filas.map((p) => ({
          ...producto(p),
          codigos: codigos.filter((c) => c.producto_id === p.id).map((c) => c.codigo),
        })),
        siguiente: siguiente(filas, q.limite),
      };
    });
  });

  app.get('/api/externa/v1/productos/:id', { config: EXTERNA }, async (req) => {
    const { id } = validar(conId, req.params);
    return req.db(async (tx) => {
      const p = await tx
        .selectFrom('productos as p')
        .leftJoin('categorias as c', (j) =>
          j.onRef('c.id', '=', 'p.categoria_id').onRef('c.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select(columnasProducto)
        .where('p.id', '=', id)
        .executeTakeFirst();
      if (!p) throw noEncontrado();
      const codigos = await tx
        .selectFrom('codigos_barra')
        .select('codigo')
        .where('producto_id', '=', id)
        .orderBy('codigo')
        .execute();
      return { ...producto(p), codigos: codigos.map((c) => c.codigo) };
    });
  });

  app.get('/api/externa/v1/ventas', { config: EXTERNA }, async (req) => {
    const q = validar(z.strictObject({ ...pagina, ...periodo }), req.query);
    const { d, h } = rango(q.desde, q.hasta);
    return req.db(async (tx) => {
      let consulta = tx
        .selectFrom('ventas')
        .select(['id', 'creada_en_dispositivo', 'estado', 'total'])
        .where('creada_en_dispositivo', '>=', d)
        .where('creada_en_dispositivo', '<', h)
        .orderBy('id')
        .limit(q.limite);
      if (q.despues) consulta = consulta.where('id', '>', q.despues);
      const filas = await consulta.execute();
      const pagos = filas.length
        ? await tx
            .selectFrom('pagos')
            .select(['venta_id', 'medio'])
            .where(
              'venta_id',
              'in',
              filas.map((f) => f.id),
            )
            .execute()
        : [];
      return {
        datos: filas.map((v) => ({
          id: v.id,
          fecha: v.creada_en_dispositivo.toISOString(),
          estado: v.estado,
          total: v.total,
          medios: [...new Set(pagos.filter((p) => p.venta_id === v.id).map((p) => p.medio))],
        })),
        siguiente: siguiente(filas, q.limite),
      };
    });
  });

  app.get('/api/externa/v1/ventas/:id', { config: EXTERNA }, async (req) => {
    const { id } = validar(conId, req.params);
    const v = await req.db((tx) => datosDeVenta(tx, id));
    if (!v) throw noEncontrado();
    return v;
  });

  app.get('/api/externa/v1/compras', { config: EXTERNA }, async (req) => {
    const q = validar(z.strictObject({ ...pagina, ...periodo }), req.query);
    const { d, h } = rango(q.desde, q.hasta);
    return req.db(async (tx) => {
      let consulta = tx
        .selectFrom('compras as c')
        .leftJoin('proveedores as pr', (j) =>
          j.onRef('pr.id', '=', 'c.proveedor_id').onRef('pr.kiosco_id', '=', 'c.kiosco_id'),
        )
        .select([
          'c.id',
          'c.created_at',
          'c.fecha',
          'c.comprobante',
          'c.numero',
          'pr.nombre as proveedor',
          'c.total',
          'c.nota',
        ])
        .select((eb) =>
          eb
            .selectFrom('compra_items as i')
            .select((e) => e.fn.countAll<string>().as('n'))
            .whereRef('i.compra_id', '=', 'c.id')
            .as('productos'),
        )
        .where('c.created_at', '>=', d)
        .where('c.created_at', '<', h)
        .orderBy('c.id')
        .limit(q.limite);
      if (q.despues) consulta = consulta.where('c.id', '>', q.despues);
      const filas = await consulta.execute();
      return {
        datos: filas.map((c) => ({
          id: c.id,
          fecha: c.created_at.toISOString(),
          fechaFactura: c.fecha,
          proveedor: c.proveedor,
          comprobante: c.comprobante,
          numero: c.numero,
          total: c.total,
          nota: c.nota,
          productos: Number(c.productos ?? 0),
        })),
        siguiente: siguiente(filas, q.limite),
      };
    });
  });

  // Resumen de un día: lo que más se usa para un informe diario por WhatsApp o mail.
  app.get('/api/externa/v1/resumen', { config: EXTERNA }, async (req) => {
    const { dia } = validar(z.strictObject({ dia: z.iso.date().optional() }), req.query);
    const elDia = dia ?? diaArgentino();
    const { d, h } = rango(elDia, elDia);
    return req.db(async (tx) => {
      const ventas = await tx
        .selectFrom('ventas')
        .select(['estado'])
        .select((eb) => [eb.fn.countAll<string>().as('n'), eb.fn.sum<string>('total').as('total')])
        .where('creada_en_dispositivo', '>=', d)
        .where('creada_en_dispositivo', '<', h)
        .where('estado', 'in', ['cobrada', 'anulada'])
        .groupBy('estado')
        .execute();
      const medios = await tx
        .selectFrom('pagos as p')
        .innerJoin('ventas as v', (j) =>
          j.onRef('v.id', '=', 'p.venta_id').onRef('v.kiosco_id', '=', 'p.kiosco_id'),
        )
        .select(['p.medio'])
        .select((eb) => eb.fn.sum<string>('p.monto').as('monto'))
        .where('v.creada_en_dispositivo', '>=', d)
        .where('v.creada_en_dispositivo', '<', h)
        .where('v.estado', '=', 'cobrada')
        .where('p.estado', '=', 'aprobado')
        .groupBy('p.medio')
        .execute();
      const cobradas = ventas.find((v) => v.estado === 'cobrada');
      const n = Number(cobradas?.n ?? 0);
      const total = Number(cobradas?.total ?? 0);
      return {
        dia: elDia,
        ventas: n,
        total,
        ticketPromedio: n ? Math.round(total / n) : 0,
        porMedio: Object.fromEntries(medios.map((m) => [m.medio, Number(m.monto ?? 0)])),
        anuladas: Number(ventas.find((v) => v.estado === 'anulada')?.n ?? 0),
      };
    });
  });

  // Datos personales: solo con el permiso "clientes" en la clave, y queda en la actividad.
  app.get(
    '/api/externa/v1/clientes',
    { config: { ...EXTERNA, permisoApi: 'clientes' } },
    async (req) => {
      const q = validar(z.strictObject(pagina), req.query);
      const clave = req.clave;
      return req.db(async (tx) => {
        let consulta = tx
          .selectFrom('clientes as c')
          .select(['c.id', 'c.nombre', 'c.telefono', 'c.limite'])
          .select(
            sql<string>`coalesce((select sum(m.monto) from movimientos_cuenta m
              where m.kiosco_id = c.kiosco_id and m.cliente_id = c.id), 0)`.as('saldo'),
          )
          .where('c.activo', '=', true)
          .orderBy('c.id')
          .limit(q.limite);
        if (q.despues) consulta = consulta.where('c.id', '>', q.despues);
        const filas = await consulta.execute();
        if (clave)
          await auditar(
            tx,
            { usuarioId: null, kioscoId: clave.kioscoId, esSoporte: false },
            'api.clientes',
            { clave: clave.id, filas: filas.length },
            req.ip,
          );
        return {
          datos: filas.map((c) => ({
            id: c.id,
            nombre: c.nombre,
            telefono: c.telefono,
            limite: c.limite,
            saldo: Number(c.saldo),
          })),
          siguiente: siguiente(filas, q.limite),
        };
      });
    },
  );
}

function producto(p: {
  id: string;
  nombre: string;
  precio: number;
  costo: number | null;
  precio_gremio: number | null;
  stock_actual: string;
  stock_minimo: string;
  unidad: string;
  activo: boolean;
  categoria: string | null;
}) {
  return {
    id: p.id,
    nombre: p.nombre,
    precio: p.precio,
    costo: p.costo,
    precioGremio: p.precio_gremio,
    categoria: p.categoria,
    stock: Number(p.stock_actual),
    minimo: Number(p.stock_minimo),
    unidad: p.unidad,
    activo: p.activo,
  };
}
