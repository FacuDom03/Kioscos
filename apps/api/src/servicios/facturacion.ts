// Facturación electrónica (docs/FACTURACION.md): qué comprobante se crea con cada venta y con
// cada anulación. Se crean pendientes en la misma transacción que la venta; la cola de facturas
// les pide el CAE después, así cobrar nunca espera a ARCA.
import type { TxKiosco } from '@mostrador/db';
import { notaDeCredito, urlQrArca, uuidv7, type TipoFactura } from '@mostrador/shared';
import {
  CUIT_PRUEBAS_AFIPSDK,
  puntoDeVentaFiscal,
  usaCuitDePrueba,
  type Facturador,
} from '@mostrador/servidor';

/** Cómo factura este servidor (sin facturación: como en modo de prueba). */
export type Modo = Pick<Facturador, 'prueba' | 'cuitPropio'>;

/** Datos fiscales si el comercio tiene la función prendida y la facturación activa. */
export async function facturacionActiva(tx: TxKiosco) {
  const k = await tx.selectFrom('kioscos').select('modulos').executeTakeFirst();
  if (!k?.modulos.includes('facturacion')) return null;
  const c = await tx.selectFrom('config_fiscal').selectAll().executeTakeFirst();
  return c?.estado === 'activa' ? c : null;
}

/** Facturas pendientes para las ventas cobradas recién registradas. Devuelve sus IDs. */
export async function facturasDeVentas(
  tx: TxKiosco,
  kioscoId: string,
  ventaIds: string[],
  modo: Modo,
): Promise<string[]> {
  if (!ventaIds.length) return [];
  const c = await facturacionActiva(tx);
  if (!c) return [];
  // Por ahora, monotributo y exento: factura C (responsable inscripto llega en la fase 3).
  if (c.condicion === 'responsable_inscripto') return [];
  const ventas = await tx
    .selectFrom('ventas')
    .select(['id', 'total'])
    .where('id', 'in', ventaIds)
    .where('estado', '=', 'cobrada')
    .where('total', '>', 0)
    .execute();
  const ids: string[] = [];
  for (const v of ventas) {
    const id = uuidv7();
    await tx
      .insertInto('comprobantes')
      .values({
        id,
        kiosco_id: kioscoId,
        venta_id: v.id,
        tipo: 'factura_c',
        punto_venta: puntoDeVentaFiscal(c, kioscoId, modo),
        total: v.total,
        prueba: modo.prueba,
      })
      .execute();
    ids.push(id);
  }
  return ids;
}

/**
 * Al anular una venta: si su factura ya tiene CAE, se hace la nota de crédito; si todavía no
 * salió, se cancela (nunca llega a ARCA). Devuelve la nota de crédito a pedir, si hay.
 */
export async function alAnularVenta(tx: TxKiosco, kioscoId: string, ventaId: string) {
  const f = await tx
    .selectFrom('comprobantes')
    .selectAll()
    .where('venta_id', '=', ventaId)
    .where('anula_id', 'is', null)
    .executeTakeFirst();
  if (!f) return null;
  if (f.estado === 'pendiente') {
    await tx
      .updateTable('comprobantes')
      .set({ estado: 'cancelado', ultimo_error: 'La venta se anuló antes de facturarla.' })
      .where('id', '=', f.id)
      .where('estado', '=', 'pendiente')
      .execute();
    return null;
  }
  if (f.estado !== 'autorizado') return null;
  const id = uuidv7();
  await tx
    .insertInto('comprobantes')
    .values({
      id,
      kiosco_id: kioscoId,
      venta_id: ventaId,
      tipo: notaDeCredito(f.tipo as TipoFactura),
      punto_venta: f.punto_venta,
      total: f.total,
      anula_id: f.id,
      receptor_condicion: f.receptor_condicion,
      receptor_doc_tipo: f.receptor_doc_tipo,
      receptor_doc_nro: f.receptor_doc_nro,
      prueba: f.prueba,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();
  return id;
}

/** La factura (y su nota de crédito, si hay) de una venta, para mostrar. */
export async function comprobantesDeVenta(tx: TxKiosco, ventaId: string, modo: Modo) {
  const filas = await tx
    .selectFrom('comprobantes')
    .select([
      'id',
      'tipo',
      'punto_venta',
      'numero',
      'fecha',
      'total',
      'estado',
      'cae',
      'cae_vence',
      'ultimo_error',
      'prueba',
      'anula_id',
    ])
    .where('venta_id', '=', ventaId)
    .orderBy('created_at')
    .execute();
  const cuit = filas.length
    ? (await tx.selectFrom('config_fiscal').select('cuit').executeTakeFirst())?.cuit
    : undefined;
  return filas.map((c) => ({
    id: c.id,
    tipo: c.tipo,
    puntoDeVenta: c.punto_venta,
    numero: c.numero,
    fecha: c.fecha,
    total: c.total,
    estado: c.estado,
    cae: c.cae,
    caeVence: c.cae_vence,
    error: c.ultimo_error,
    prueba: c.prueba,
    anulaId: c.anula_id,
    // El QR del comprobante abre la página de ARCA que lo verifica.
    qr:
      c.estado === 'autorizado' && c.cae && c.numero && c.fecha && (cuit || c.prueba)
        ? urlQrArca({
            fecha: c.fecha,
            cuitEmisor: c.prueba && usaCuitDePrueba(modo) ? CUIT_PRUEBAS_AFIPSDK : (cuit ?? ''),
            puntoDeVenta: c.punto_venta,
            tipo: c.tipo,
            numero: c.numero,
            totalCentavos: c.total,
            cae: c.cae,
          })
        : null,
  }));
}

/** Los datos del comercio que van impresos en la factura. */
export async function emisorFiscal(tx: TxKiosco) {
  const c = await tx
    .selectFrom('config_fiscal')
    .select(['cuit', 'razon_social', 'condicion', 'domicilio', 'iibb', 'inicio_actividades'])
    .executeTakeFirst();
  return c
    ? {
        cuit: c.cuit,
        razonSocial: c.razon_social,
        condicion: c.condicion,
        domicilio: c.domicilio,
        iibb: c.iibb,
        inicioActividades: c.inicio_actividades,
      }
    : null;
}
