// Exportar ventas y compras en CSV para el contador, exportar todos los datos y borrar la
// cuenta (secciones 2 y 18). Todo queda en la auditoría.
import type { FastifyInstance } from 'fastify';
import { sql } from '@mostrador/db';
import { verificarPassword } from '@mostrador/servidor';
import { armarCsv } from '@mostrador/shared';
import { z } from 'zod';
import { ErrorPublico } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { borrarOtrasSesiones } from '../servicios/sesiones.ts';
import { borrarCookieSesion } from '../sesion.ts';
import { validar } from '../validar.ts';

const rango = z.strictObject({ desde: z.iso.date(), hasta: z.iso.date() });
const ZONA = 'America/Argentina/Buenos_Aires';
const desdeAR = (d: string) => new Date(`${d}T00:00:00-03:00`);
const hastaAR = (d: string) => new Date(desdeAR(d).getTime() + 86_400_000);
const fechaAR = (d: Date) => d.toLocaleString('es-AR', { timeZone: ZONA });
const pesos = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const MEDIOS: Record<string, string> = {
  efectivo: 'Efectivo',
  qr_mp: 'QR Mercado Pago',
  transferencia: 'Transferencia',
  cuenta_corriente: 'A cuenta',
};
const ESTADOS: Record<string, string> = {
  cobrada: 'Cobrada',
  anulada: 'Anulada',
  pendiente_cobro: 'Pendiente de cobro',
  abierta: 'Abierta',
};

export async function rutasExportar(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/exportar/ventas.csv', { config: { roles: ['dueno'] } }, async (req, reply) => {
    const { desde, hasta } = validar(rango, req.query);
    const csv = await req.db(async (tx) => {
      const ventas = await tx
        .selectFrom('ventas as v')
        .leftJoin('usuarios as u', 'u.id', 'v.usuario_id')
        .select([
          'v.id',
          'v.creada_en_dispositivo',
          'v.total',
          'v.estado',
          'v.motivo_anulacion',
          'u.nombre',
        ])
        .where('v.creada_en_dispositivo', '>=', desdeAR(desde))
        .where('v.creada_en_dispositivo', '<', hastaAR(hasta))
        .orderBy('v.creada_en_dispositivo')
        .execute();
      const ids = ventas.map((v) => v.id);
      const pagos = ids.length
        ? await tx
            .selectFrom('pagos')
            .select(['venta_id', 'medio', 'monto'])
            .where('venta_id', 'in', ids)
            .where('estado', 'in', ['aprobado', 'devuelto'])
            .execute()
        : [];
      const items = ids.length
        ? await tx
            .selectFrom('venta_items')
            .select(['venta_id', 'descripcion', 'cantidad'])
            .where('venta_id', 'in', ids)
            .execute()
        : [];
      // Promos y cambios (etapa I7): el total ya viene neto; esto explica la diferencia.
      const descuentos = ids.length
        ? await tx
            .selectFrom('venta_descuentos')
            .select(['venta_id', 'monto'])
            .where('venta_id', 'in', ids)
            .execute()
        : [];
      const devueltos = ids.length
        ? await tx
            .selectFrom('devoluciones')
            .select(['venta_id', 'descripcion', 'cantidad', 'importe'])
            .where('venta_id', 'in', ids)
            .execute()
        : [];
      await auditar(tx, req.completa, 'exportacion.csv', { tipo: 'ventas', desde, hasta }, req.ip);
      return armarCsv([
        [
          'Fecha',
          'Total',
          'Descuento por promos',
          'Medio de pago',
          'Estado',
          'Atendió',
          'Productos',
          'Motivo de anulación',
          'ID',
        ],
        ...ventas.map((v) => [
          fechaAR(v.creada_en_dispositivo),
          pesos(v.total),
          pesos(
            descuentos.filter((d) => d.venta_id === v.id).reduce((t, d) => t + d.monto, 0) || null,
          ),
          [...new Set(pagos.filter((p) => p.venta_id === v.id).map((p) => MEDIOS[p.medio]))].join(
            ' + ',
          ),
          ESTADOS[v.estado] ?? v.estado,
          v.nombre ?? '',
          [
            ...items
              .filter((i) => i.venta_id === v.id)
              .map((i) => `${Number(i.cantidad)} x ${i.descripcion}`),
            ...devueltos
              .filter((d) => d.venta_id === v.id)
              .map(
                (d) =>
                  `cambio: devuelve ${Number(d.cantidad)} x ${d.descripcion} (${pesos(d.importe)})`,
              ),
          ].join(', '),
          v.motivo_anulacion ?? '',
          v.id,
        ]),
      ]);
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="ventas-${desde}-a-${hasta}.csv"`)
      .send(csv);
  });

  app.get('/api/v1/exportar/compras.csv', { config: { roles: ['dueno'] } }, async (req, reply) => {
    const { desde, hasta } = validar(rango, req.query);
    const csv = await req.db(async (tx) => {
      const filas = await tx
        .selectFrom('compra_items as i')
        .innerJoin('compras as c', (j) =>
          j.onRef('c.id', '=', 'i.compra_id').onRef('c.kiosco_id', '=', 'i.kiosco_id'),
        )
        .innerJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'i.producto_id').onRef('p.kiosco_id', '=', 'i.kiosco_id'),
        )
        .select([
          'c.created_at',
          'c.nota',
          'p.nombre',
          'i.cantidad',
          'i.costo_unitario',
          'i.subtotal',
          'c.id',
        ])
        .where('c.created_at', '>=', desdeAR(desde))
        .where('c.created_at', '<', hastaAR(hasta))
        .orderBy('c.created_at')
        .execute();
      await auditar(tx, req.completa, 'exportacion.csv', { tipo: 'compras', desde, hasta }, req.ip);
      return armarCsv([
        ['Fecha', 'Producto', 'Cantidad', 'Costo unitario', 'Subtotal', 'Nota', 'Compra'],
        ...filas.map((f) => [
          fechaAR(f.created_at),
          f.nombre,
          String(Number(f.cantidad)).replace('.', ','),
          pesos(f.costo_unitario),
          pesos(f.subtotal),
          f.nota ?? '',
          f.id,
        ]),
      ]);
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="compras-${desde}-a-${hasta}.csv"`)
      .send(csv);
  });

  // Todos los datos del kiosco en un JSON (sin contraseñas, tokens ni hashes).
  app.get('/api/v1/exportar/todo.json', { config: { roles: ['dueno'] } }, async (req, reply) => {
    const datos = await req.db(async (tx) => {
      const r = {
        exportado: new Date().toISOString(),
        kiosco: await tx
          .selectFrom('kioscos')
          .select(['id', 'nombre', 'cuit', 'plan', 'created_at'])
          .executeTakeFirst(),
        personas: await tx
          .selectFrom('membresias as m')
          .innerJoin('usuarios as u', 'u.id', 'm.usuario_id')
          .select(['u.nombre', 'u.email', 'm.rol', 'm.activa'])
          .execute(),
        categorias: await tx.selectFrom('categorias').select(['id', 'nombre', 'orden']).execute(),
        productos: await tx
          .selectFrom('productos')
          .select([
            'id',
            'nombre',
            'precio',
            'costo',
            'categoria_id',
            'stock_actual',
            'stock_minimo',
            'activo',
            'unidad',
            'ubicacion',
            'precio_gremio',
            'grupo_id',
            'variante',
            'color',
          ])
          .execute(),
        gruposVariantes: await tx
          .selectFrom('grupos_variantes')
          .select(['id', 'nombre', 'tipo'])
          .execute(),
        promos: await tx
          .selectFrom('promos')
          .select([
            'id',
            'nombre',
            'lleva',
            'paga',
            'descuento',
            'categoria_id',
            'grupo_id',
            'desde',
            'hasta',
            'activa',
          ])
          .execute(),
        lotes: await tx
          .selectFrom('lotes')
          .select(['producto_id', 'vence_en', 'cantidad', 'retirado', 'created_at'])
          .execute(),
        proveedores: await tx
          .selectFrom('proveedores')
          .select(['id', 'nombre', 'activo'])
          .execute(),
        productosProveedor: await tx
          .selectFrom('producto_proveedor')
          .select(['producto_id', 'proveedor_id', 'codigo', 'costo', 'actualizado_en'])
          .execute(),
        clientes: await tx
          .selectFrom('clientes')
          .select(['id', 'nombre', 'telefono', 'nota', 'limite', 'activo', 'created_at'])
          .execute(),
        movimientosCuenta: await tx
          .selectFrom('movimientos_cuenta')
          .select(['cliente_id', 'tipo', 'monto', 'medio', 'venta_id', 'nota', 'created_at'])
          .execute(),
        presupuestos: await tx
          .selectFrom('presupuestos')
          .select([
            'id',
            'numero',
            'lista',
            'para',
            'nota',
            'total',
            'estado',
            'vence_en',
            'venta_id',
            'created_at',
          ])
          .execute(),
        presupuestoItems: await tx
          .selectFrom('presupuesto_items')
          .select([
            'presupuesto_id',
            'producto_id',
            'descripcion',
            'cantidad',
            'unidad',
            'precio_unitario',
            'subtotal',
          ])
          .execute(),
        codigos: await tx
          .selectFrom('codigos_barra')
          .select(['producto_id', 'codigo', 'tipo'])
          .execute(),
        ventas: await tx
          .selectFrom('ventas')
          .select([
            'id',
            'turno_id',
            'total',
            'estado',
            'lista',
            'regalo',
            'creada_en_dispositivo',
            'motivo_anulacion',
          ])
          .execute(),
        ventaDescuentos: await tx
          .selectFrom('venta_descuentos')
          .select(['venta_id', 'promo_id', 'descripcion', 'monto'])
          .execute(),
        devoluciones: await tx
          .selectFrom('devoluciones')
          .select([
            'venta_id',
            'venta_item_id',
            'producto_id',
            'descripcion',
            'cantidad',
            'importe',
          ])
          .execute(),
        ventaItems: await tx
          .selectFrom('venta_items')
          .select([
            'venta_id',
            'producto_id',
            'descripcion',
            'cantidad',
            'precio_unitario',
            'subtotal',
          ])
          .execute(),
        pagos: await tx
          .selectFrom('pagos')
          .select(['venta_id', 'medio', 'monto', 'recibido', 'vuelto', 'estado', 'confirmado_en'])
          .execute(),
        turnos: await tx
          .selectFrom('turnos_caja')
          .select([
            'id',
            'abierto_en',
            'cerrado_en',
            'cambio_inicial',
            'esperado',
            'contado',
            'diferencia',
            'nota',
          ])
          .execute(),
        gastos: await tx
          .selectFrom('gastos')
          .select(['turno_id', 'tipo', 'monto', 'motivo', 'created_at'])
          .execute(),
        compras: await tx
          .selectFrom('compras')
          .select(['id', 'total', 'nota', 'created_at'])
          .execute(),
        compraItems: await tx
          .selectFrom('compra_items')
          .select(['compra_id', 'producto_id', 'cantidad', 'costo_unitario', 'subtotal'])
          .execute(),
        movimientosStock: await tx
          .selectFrom('movimientos_stock')
          .select(['producto_id', 'tipo', 'cantidad', 'motivo', 'created_at'])
          .execute(),
        cambiosPrecio: await tx
          .selectFrom('cambios_precio')
          .select(['alcance', 'porcentaje', 'redondeo', 'detalle', 'deshecho_en', 'created_at'])
          .execute(),
      };
      await auditar(tx, req.completa, 'exportacion.csv', { tipo: 'todo' }, req.ip);
      return r;
    });
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header(
        'content-disposition',
        `attachment; filename="mostrador-datos-${new Date().toISOString().slice(0, 10)}.json"`,
      )
      .send(JSON.stringify(datos, null, 2));
  });

  // Borrar todo: pide escribir el nombre del kiosco y la contraseña.
  app.post(
    '/api/v1/kiosco/borrar',
    { config: { roles: ['dueno'], rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const d = validar(
        z.strictObject({ nombreKiosco: z.string().max(120), password: z.string().min(1).max(128) }),
        req.body,
      );
      const s = req.completa;
      if (s.esSoporte)
        throw new ErrorPublico(403, 'sin_permiso', 'Soporte no puede borrar la cuenta.');
      await req.db(async (tx) => {
        const k = await tx.selectFrom('kioscos').select('nombre').executeTakeFirstOrThrow();
        const u = await tx
          .selectFrom('usuarios')
          .select('password_hash')
          .where('id', '=', s.usuarioId)
          .executeTakeFirst();
        if (d.nombreKiosco.trim() !== k.nombre)
          throw new ErrorPublico(400, 'confirmacion', 'El nombre del kiosco no coincide.');
        if (!u || !(await verificarPassword(u.password_hash, d.password)))
          throw new ErrorPublico(400, 'password', 'La contraseña no es correcta.');
        await sql`select kiosco_borrar_datos(${s.usuarioId})`.execute(tx);
      });
      await borrarOtrasSesiones(app.base, s.usuarioId, null);
      borrarCookieSesion(app, reply);
      return { ok: true };
    },
  );
}
