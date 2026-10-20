// Exportar ventas y compras en CSV para el contador, exportar todos los datos y borrar la
// cuenta (secciones 2 y 18). Todo queda en la auditoría.
import type { FastifyInstance } from 'fastify';
import { sql } from '@mostrador/db';
import { verificarPassword } from '@mostrador/servidor';
import {
  armarCsv,
  COMPROBANTES_COMPRA,
  TIPO_COMPROBANTE,
  TIPO_DOCUMENTO,
  diaCorto,
  escribirXlsx,
  planillaDeStock,
} from '@mostrador/shared';
import { z } from 'zod';
import { ErrorPublico } from '../errores.ts';
import { auditar } from '../servicios/auditoria.ts';
import { tieneModulo } from '../servicios/negocio.ts';
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
const NOMBRE_COMPROBANTE: Record<string, string> = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  nota_credito_a: 'Nota de Crédito A',
  nota_credito_b: 'Nota de Crédito B',
  nota_credito_c: 'Nota de Crédito C',
};
const ESTADOS: Record<string, string> = {
  cobrada: 'Cobrada',
  anulada: 'Anulada',
  pendiente_cobro: 'Pendiente de cobro',
  abierta: 'Abierta',
};

export async function rutasExportar(app: FastifyInstance): Promise<void> {
  // "Descargar mi stock": Excel con las columnas de la planilla para importar. El costo solo va
  // para quien lo puede ver (no el cajero, que igual no entra a Stock a editar).
  app.get(
    '/api/v1/exportar/productos.xlsx',
    { config: { roles: ['dueno', 'encargado', 'soporte'] } },
    async (req, reply) => {
      const costos = req.completa.rol !== 'cajero';
      const { hojas } = await req.db(async (tx) => {
        const kiosco = await tx
          .selectFrom('kioscos')
          .select('rubro')
          .where('id', '=', req.completa.kioscoId)
          .executeTakeFirstOrThrow();
        const [unidades, ubicaciones, gremio] = await Promise.all([
          tieneModulo(tx, 'venta_fraccionada'),
          tieneModulo(tx, 'ubicaciones'),
          tieneModulo(tx, 'listas_precios'),
        ]);
        const filas = await tx
          .selectFrom('productos as p')
          .leftJoin('categorias as c', 'c.id', 'p.categoria_id')
          .select([
            'p.nombre',
            'p.precio',
            'p.costo',
            'p.stock_actual',
            'p.stock_minimo',
            'p.unidad',
            'p.ubicacion',
            'p.precio_gremio',
            'c.nombre as categoria',
            (eb) =>
              eb
                .selectFrom('codigos_barra as b')
                .select((e) => e.fn.min('b.codigo').as('codigo'))
                .whereRef('b.producto_id', '=', 'p.id')
                .as('codigo'),
          ])
          .where('p.activo', '=', true)
          .orderBy('p.nombre')
          .execute();
        await auditar(tx, req.completa, 'exportacion.xlsx', { tipo: 'productos' }, req.ip);
        return {
          hojas: planillaDeStock(
            { rubro: kiosco.rubro, unidades, ubicaciones, gremio, costos },
            filas.map((f) => ({
              nombre: f.nombre,
              precio: Number(f.precio),
              codigo: f.codigo ?? null,
              categoria: f.categoria ?? null,
              costo: costos && f.costo !== null ? Number(f.costo) : null,
              stock: Number(f.stock_actual),
              minimo: Number(f.stock_minimo),
              unidad: f.unidad,
              ubicacion: f.ubicacion,
              gremio: f.precio_gremio === null ? null : Number(f.precio_gremio),
            })),
          ),
        };
      });
      const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: ZONA });
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename="stock-${fecha}.xlsx"`)
        .send(Buffer.from(escribirXlsx(hojas)));
    },
  );

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
        .leftJoin('productos as p', (j) =>
          j.onRef('p.id', '=', 'i.producto_id').onRef('p.kiosco_id', '=', 'i.kiosco_id'),
        )
        .leftJoin('proveedores as pr', (j) =>
          j.onRef('pr.id', '=', 'c.proveedor_id').onRef('pr.kiosco_id', '=', 'c.kiosco_id'),
        )
        .select([
          'c.created_at',
          'c.fecha',
          'c.comprobante',
          'c.numero',
          'pr.nombre as proveedor',
          'c.nota',
          'p.nombre',
          'i.descripcion',
          'i.suma_stock',
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
        [
          'Fecha',
          'Fecha de la factura',
          'Proveedor',
          'Comprobante',
          'Número',
          'Producto',
          'Cantidad',
          'Costo unitario',
          'Subtotal',
          'Sumó stock',
          'Nota',
          'Compra',
        ],
        ...filas.map((f) => [
          fechaAR(f.created_at),
          f.fecha ? diaCorto(f.fecha) : '',
          f.proveedor ?? '',
          f.comprobante ? COMPROBANTES_COMPRA[f.comprobante] : '',
          f.numero ?? '',
          f.nombre ?? f.descripcion ?? 'Producto borrado',
          String(Number(f.cantidad)).replace('.', ','),
          pesos(f.costo_unitario),
          pesos(f.subtotal),
          f.suma_stock ? 'Sí' : 'No',
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

  // Facturas y notas de crédito con las columnas de "Mis Comprobantes" de ARCA, para que el
  // contador las importe como siempre (Xubio, Colppy, Holistor). Las notas de crédito van en
  // positivo, como en ARCA: el tipo dice que restan.
  app.get(
    '/api/v1/exportar/comprobantes.csv',
    { config: { roles: ['dueno'] } },
    async (req, reply) => {
      const { desde, hasta } = validar(rango, req.query);
      const prueba = app.facturacion?.facturador.prueba ?? true;
      const csv = await req.db(async (tx) => {
        const filas = await tx
          .selectFrom('comprobantes')
          .select([
            'fecha',
            'tipo',
            'punto_venta',
            'numero',
            'cae',
            'receptor_doc_tipo',
            'receptor_doc_nro',
            'total',
          ])
          .where('estado', '=', 'autorizado')
          .where('prueba', '=', prueba)
          .where('fecha', '>=', desde)
          .where('fecha', '<=', hasta)
          .orderBy('fecha')
          .orderBy('tipo')
          .orderBy('punto_venta')
          .orderBy('numero')
          .execute();
        await auditar(
          tx,
          req.completa,
          'exportacion.csv',
          { tipo: 'comprobantes', desde, hasta },
          req.ip,
        );
        return armarCsv([
          [
            'Fecha',
            'Tipo',
            'Punto de Venta',
            'Número Desde',
            'Número Hasta',
            'Cód. Autorización',
            'Tipo Doc. Receptor',
            'Nro. Doc. Receptor',
            'Denominación Receptor',
            'Tipo Cambio',
            'Moneda',
            'Imp. Neto Gravado',
            'Imp. Neto No Gravado',
            'Imp. Op. Exentas',
            'Otros Tributos',
            'IVA',
            'Imp. Total',
          ],
          ...filas.map((f) => [
            f.fecha ? diaCorto(f.fecha) : '',
            `${TIPO_COMPROBANTE[f.tipo]} - ${NOMBRE_COMPROBANTE[f.tipo]}`,
            f.punto_venta,
            f.numero,
            f.numero,
            f.cae,
            f.receptor_doc_tipo
              ? TIPO_DOCUMENTO[f.receptor_doc_tipo]
              : TIPO_DOCUMENTO.sin_identificar,
            f.receptor_doc_nro ?? 0,
            '',
            '1,00',
            '$',
            // Factura C: todo el importe es neto (no se discrimina IVA), como se le informa a ARCA.
            pesos(f.total),
            pesos(0),
            pesos(0),
            pesos(0),
            pesos(0),
            pesos(f.total),
          ]),
        ]);
      });
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="comprobantes-${desde}-a-${hasta}.csv"`,
        )
        .send(csv);
    },
  );

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
