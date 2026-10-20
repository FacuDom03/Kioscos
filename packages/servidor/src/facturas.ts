// Cola de facturas (docs/FACTURACION.md): cada comprobante pendiente se numera y se le pide el CAE
// a ARCA, de a uno. Si se corta la respuesta, antes de reintentar se consulta si ese número ya
// quedó autorizado: nunca salen dos facturas por una venta. Lo usan el worker y la API.
import { sinKiosco, sql, withKiosco, type BaseApp } from '@mostrador/db';
import {
  camposDelComprobante,
  diaArgentino,
  puntoDeVentaDePrueba,
  sumarDias,
  TIPO_COMPROBANTE,
  TERMINOS_FACTURACION,
  uuidv7,
  type TipoFactura,
} from '@mostrador/shared';
import { CUIT_PRUEBAS_AFIPSDK, ErrorAfip, type ClienteAfipSdk } from './afipsdk.ts';

export interface Facturador {
  cliente: ClienteAfipSdk;
  /** Ambiente de pruebas de ARCA (homologación): las facturas no valen. */
  prueba: boolean;
  /**
   * En pruebas, facturar con el CUIT del comercio (hace falta el certificado de pruebas de
   * Mostrador autorizado para ese CUIT en WSASS). Si no, todo sale con el CUIT de pruebas de
   * Afip SDK. En producción siempre es el CUIT del comercio.
   */
  cuitPropio?: boolean;
  /** Hoy en la Argentina (en pruebas, otro día). */
  hoy?: () => string;
}

export type ResultadoFactura =
  | { estado: 'autorizado'; numero: number; cae: string }
  | { estado: 'rechazado'; motivo: string }
  /** `caido`: ARCA o Afip SDK no respondieron (no tiene sentido seguir con las demás). */
  | { estado: 'reintentar'; motivo: string; caido: boolean }
  | { estado: 'omitido'; motivo: string };

const AUTORIZACION = /no autorizado|not authorized|notauthorized|coe\.notauthorized/i;
const recortar = (texto: string) => texto.slice(0, 300);

/** ¿Se factura con el CUIT de pruebas compartido de Afip SDK? */
export const usaCuitDePrueba = (f: Pick<Facturador, 'prueba' | 'cuitPropio'>) =>
  f.prueba && !f.cuitPropio;

/** El CUIT con el que se factura: el del comercio, o el de pruebas compartido. */
const cuitEmisor = (cuit: string, f: Facturador) =>
  usaCuitDePrueba(f) ? CUIT_PRUEBAS_AFIPSDK : cuit;

/** Explica con palabras por qué no se pudo hablar con ARCA. */
export function explicarErrorAfip(error: unknown): string {
  if (!(error instanceof ErrorAfip)) return 'Error inesperado al facturar.';
  if (AUTORIZACION.test(error.message))
    return 'ARCA no tiene la autorización a Mostrador para facturar con este CUIT.';
  if (error.tipo === 'red') return 'ARCA o Afip SDK no respondieron. Se reintenta solo.';
  if (error.tipo === 'servicio') return 'ARCA o Afip SDK están con problemas. Se reintenta solo.';
  return `ARCA rechazó el comprobante: ${error.message}`;
}

/**
 * Prueba que se puede facturar con los datos del comercio (que ARCA tenga la autorización a
 * Mostrador y el punto de venta). Si anda, la facturación queda activa.
 */
export async function verificarFacturacion(
  base: BaseApp,
  kioscoId: string,
  f: Facturador,
): Promise<{ activa: boolean; mensaje: string | null }> {
  const c = await withKiosco(base, kioscoId, (tx) =>
    tx.selectFrom('config_fiscal').selectAll().executeTakeFirst(),
  );
  if (!c) return { activa: false, mensaje: 'Falta cargar los datos de facturación.' };
  if (c.terminos_version !== TERMINOS_FACTURACION.version)
    return { activa: false, mensaje: 'Falta aceptar los términos de la facturación.' };
  let mensaje: string | null = null;
  try {
    const cuit = cuitEmisor(c.cuit, f);
    if (!f.prueba) {
      const puntos = await f.cliente.puntosDeVenta(cuit);
      const pv = puntos.find((p) => p.numero === c.punto_venta);
      if (!pv || pv.baja || pv.bloqueado)
        mensaje = `El punto de venta ${c.punto_venta} no está habilitado para Web Services en ARCA. Revisá el paso 2 de la guía.`;
    }
    if (!mensaje) await f.cliente.ultimoAutorizado(cuit, puntoDeVentaFiscal(c, kioscoId, f), 11);
  } catch (error) {
    mensaje = AUTORIZACION.test(error instanceof Error ? error.message : '')
      ? 'ARCA todavía no confirma la autorización a Mostrador. Si ya la diste, la aceptamos en unas horas.'
      : explicarErrorAfip(error);
  }
  const ahora = new Date();
  const activa = !mensaje;
  await withKiosco(base, kioscoId, (tx) =>
    tx
      .updateTable('config_fiscal')
      .set({
        verificada_en: ahora,
        ultimo_error: mensaje ? recortar(mensaje) : null,
        updated_at: ahora,
        ...(activa && (c.estado === 'pendiente' || c.estado === 'desconectada')
          ? { estado: 'activa' as const, activada_en: ahora }
          : {}),
        ...(!activa && c.estado === 'activa' && mensaje && AUTORIZACION.test(mensaje)
          ? { estado: 'desconectada' as const }
          : {}),
      })
      .where('id', '=', c.id)
      .execute(),
  );
  return { activa: activa && c.estado !== 'pausada', mensaje };
}

/** Punto de venta con el que factura el comercio (con el CUIT de pruebas, uno propio). */
export function puntoDeVentaFiscal(
  c: { punto_venta: number },
  kioscoId: string,
  f: Pick<Facturador, 'prueba' | 'cuitPropio'>,
): number {
  return usaCuitDePrueba(f) ? puntoDeVentaDePrueba(kioscoId) : c.punto_venta;
}

/** Pide el CAE de un comprobante pendiente. */
export async function procesarComprobante(
  base: BaseApp,
  kioscoId: string,
  comprobanteId: string,
  f: Facturador,
): Promise<ResultadoFactura> {
  const hoy = f.hoy?.() ?? diaArgentino();
  const d = await withKiosco(base, kioscoId, async (tx) => {
    const comp = await tx
      .selectFrom('comprobantes')
      .selectAll()
      .where('id', '=', comprobanteId)
      .executeTakeFirst();
    if (!comp) return null;
    const config = await tx.selectFrom('config_fiscal').selectAll().executeTakeFirst();
    const venta = await tx
      .selectFrom('ventas')
      .select('creada_en_dispositivo')
      .where('id', '=', comp.venta_id)
      .executeTakeFirstOrThrow();
    const anulada = comp.anula_id
      ? await tx
          .selectFrom('comprobantes')
          .select(['tipo', 'punto_venta', 'numero', 'estado'])
          .where('id', '=', comp.anula_id)
          .executeTakeFirst()
      : null;
    return { comp, config, venta, anulada };
  });
  if (!d) return { estado: 'omitido', motivo: 'No existe el comprobante.' };
  const { comp, config, venta, anulada } = d;
  if (comp.estado !== 'pendiente') return { estado: 'omitido', motivo: 'Ya no está pendiente.' };
  if (!config || config.estado !== 'activa')
    return { estado: 'omitido', motivo: 'La facturación no está activa.' };
  // Lo que quedó pendiente de las pruebas no se manda a ARCA de verdad (ni al revés).
  if (comp.prueba !== f.prueba) {
    const motivo = comp.prueba
      ? 'Quedó del modo de prueba: no se factura.'
      : 'Es de producción: no se manda al ambiente de pruebas.';
    await withKiosco(base, kioscoId, (tx) =>
      tx
        .updateTable('comprobantes')
        .set({ estado: 'cancelado', ultimo_error: motivo })
        .where('id', '=', comp.id)
        .where('estado', '=', 'pendiente')
        .execute(),
    );
    return { estado: 'omitido', motivo };
  }

  const cuit = cuitEmisor(config.cuit, f);
  const tipo = TIPO_COMPROBANTE[comp.tipo];
  const guardar = (cambio: {
    estado?: 'autorizado' | 'rechazado';
    numero?: number | null;
    fecha?: string | null;
    cae?: string;
    cae_vence?: string;
    ultimo_error?: string | null;
    intento?: boolean;
  }) =>
    withKiosco(base, kioscoId, (tx) =>
      tx
        .updateTable('comprobantes')
        .set((eb) => ({
          ...(cambio.estado ? { estado: cambio.estado } : {}),
          ...(cambio.numero !== undefined ? { numero: cambio.numero } : {}),
          ...(cambio.fecha !== undefined ? { fecha: cambio.fecha } : {}),
          ...(cambio.cae ? { cae: cambio.cae, cae_vence: cambio.cae_vence ?? null } : {}),
          ...(cambio.estado === 'autorizado' ? { autorizado_en: new Date() } : {}),
          ...(cambio.ultimo_error !== undefined
            ? { ultimo_error: cambio.ultimo_error && recortar(cambio.ultimo_error) }
            : {}),
          ...(cambio.intento ? { intentos: eb('intentos', '+', 1) } : {}),
        }))
        .where('id', '=', comprobanteId)
        .where('estado', '=', 'pendiente')
        .execute(),
    );

  // Tope diario (decisión 010): lo que lo pase espera a que Mostrador lo revise en el panel.
  // Las notas de crédito no cuentan, y un intento que ya tomó número se termina.
  if (!comp.anula_id && !comp.numero) {
    const hecho = await withKiosco(base, kioscoId, (tx) =>
      tx
        .selectFrom('comprobantes')
        .select((eb) => eb.fn.sum<string>('total').as('suma'))
        .where('estado', '=', 'autorizado')
        .where('anula_id', 'is', null)
        .where('fecha', '=', hoy)
        .executeTakeFirst(),
    );
    if (Number(hecho?.suma ?? 0) + comp.total > config.tope_diario) {
      const motivo = 'Se llegó al tope diario de facturación: Mostrador lo revisa y sale después.';
      await guardar({ ultimo_error: motivo });
      return { estado: 'omitido', motivo };
    }
  }

  try {
    // Un intento anterior ya tomó un número: si ARCA lo autorizó y se perdió la respuesta, se
    // usa ese CAE en lugar de pedir otra factura.
    if (comp.numero) {
      const previo = await f.cliente.consultar(cuit, comp.punto_venta, tipo, comp.numero);
      if (
        previo &&
        Math.round(Number(previo['ImpTotal']) * 100) === comp.total &&
        previo['CodAutorizacion']
      ) {
        const vto = String(previo['FchVto'] ?? '');
        const cae = String(previo['CodAutorizacion']);
        await guardar({
          estado: 'autorizado',
          cae,
          cae_vence: /^\d{8}$/.test(vto)
            ? `${vto.slice(0, 4)}-${vto.slice(4, 6)}-${vto.slice(6, 8)}`
            : hoy,
          ultimo_error: null,
        });
        return { estado: 'autorizado', numero: comp.numero, cae };
      }
    }

    // Número y fecha: ARCA exige que vayan en orden, y acepta la fecha real de la venta hasta 5
    // días después. Si se pasó, no se inventa otra fecha.
    const fechaVenta = diaArgentino(venta.creada_en_dispositivo);
    if (fechaVenta < sumarDias(hoy, -5)) {
      const motivo =
        'Pasaron más de 5 días desde la venta y ARCA ya no acepta esa fecha. Consultalo con tu contador.';
      await guardar({ estado: 'rechazado', ultimo_error: motivo, numero: null });
      return { estado: 'rechazado', motivo };
    }
    const p = await f.cliente.proximo(cuit, comp.punto_venta, tipo);
    const fecha = p.fechaMinima && p.fechaMinima > fechaVenta ? p.fechaMinima : fechaVenta;
    await guardar({ numero: p.numero, fecha, intento: true });

    let campos;
    try {
      campos = camposDelComprobante({
        emisor: config.condicion,
        tipo: comp.tipo,
        puntoDeVenta: comp.punto_venta,
        numero: p.numero,
        fecha,
        comprador: {
          condicion: comp.receptor_condicion,
          ...(comp.receptor_doc_tipo && comp.receptor_doc_nro
            ? { documento: { tipo: comp.receptor_doc_tipo, numero: comp.receptor_doc_nro } }
            : {}),
        },
        // Para la factura C alcanza con el total.
        lineas: [{ subtotal: comp.total, alicuota: 21 }],
        ...(anulada?.numero
          ? {
              anula: {
                tipo: anulada.tipo as TipoFactura,
                puntoDeVenta: anulada.punto_venta,
                numero: anulada.numero,
                cuitEmisor: cuit,
              },
            }
          : {}),
      });
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'Datos inválidos.';
      await guardar({ estado: 'rechazado', ultimo_error: motivo, numero: null });
      return { estado: 'rechazado', motivo };
    }

    const r = await f.cliente.solicitarCae(cuit, campos);
    await guardar({
      estado: 'autorizado',
      cae: r.cae,
      cae_vence: r.vencimiento,
      ultimo_error: null,
    });
    return { estado: 'autorizado', numero: p.numero, cae: r.cae };
  } catch (error) {
    const motivo = explicarErrorAfip(error);
    if (error instanceof ErrorAfip && error.tipo === 'arca' && error.codigo === 10016) {
      // Ese número no era el próximo: se vuelve a leer en el próximo intento.
      await guardar({ numero: null, ultimo_error: motivo });
      return { estado: 'reintentar', motivo, caido: false };
    }
    if (error instanceof ErrorAfip && error.tipo === 'arca') {
      await guardar({ estado: 'rechazado', ultimo_error: motivo, numero: null });
      return { estado: 'rechazado', motivo };
    }
    if (error instanceof Error && AUTORIZACION.test(error.message)) {
      await withKiosco(base, kioscoId, (tx) =>
        tx
          .updateTable('config_fiscal')
          .set({ estado: 'desconectada', ultimo_error: recortar(motivo), updated_at: new Date() })
          .where('estado', '=', 'activa')
          .execute(),
      );
    }
    await guardar({ ultimo_error: motivo });
    return { estado: 'reintentar', motivo, caido: true };
  }
}

/**
 * Ventas cobradas desde que se activó la facturación que no tienen factura (por ejemplo, las
 * cobradas con QR, que se confirman después). Devuelve los comprobantes creados.
 */
export async function crearComprobantesFaltantes(
  base: BaseApp,
  kioscoId: string,
  f: Facturador,
): Promise<string[]> {
  return withKiosco(base, kioscoId, async (tx) => {
    const c = await tx.selectFrom('config_fiscal').selectAll().executeTakeFirst();
    if (!c || c.estado !== 'activa' || !c.activada_en) return [];
    const desde = new Date(Math.max(c.activada_en.getTime(), Date.now() - 4 * 86_400_000));
    const ventas = await tx
      .selectFrom('ventas as v')
      .select(['v.id', 'v.total'])
      .where('v.estado', '=', 'cobrada')
      .where('v.total', '>', 0)
      .where('v.creada_en_dispositivo', '>=', desde)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('comprobantes as x')
              .select('x.id')
              .whereRef('x.venta_id', '=', 'v.id')
              .where('x.anula_id', 'is', null),
          ),
        ),
      )
      .limit(200)
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
          punto_venta: puntoDeVentaFiscal(c, kioscoId, f),
          total: v.total,
          prueba: f.prueba,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      ids.push(id);
    }
    return ids;
  });
}

/** Comprobantes pendientes de un comercio (los más viejos primero). */
export async function comprobantesPendientes(base: BaseApp, kioscoId: string): Promise<string[]> {
  const filas = await withKiosco(base, kioscoId, (tx) =>
    tx
      .selectFrom('comprobantes')
      .select('id')
      .where('estado', '=', 'pendiente')
      .orderBy('created_at')
      .limit(500)
      .execute(),
  );
  return filas.map((f) => f.id);
}

/** Comercios con la facturación activa o esperando la confirmación de ARCA (para el worker). */
export async function kioscosConFacturacion(
  base: BaseApp,
): Promise<{ kiosco_id: string; estado: 'activa' | 'pendiente' }[]> {
  const { rows } = await sinKiosco(base, (tx) =>
    sql<{
      kiosco_id: string;
      estado: 'activa' | 'pendiente';
    }>`select * from fact_kioscos_a_revisar()`.execute(tx),
  );
  return rows;
}

/**
 * Revisión periódica de un comercio (la hace el worker cada dos minutos):
 * - si espera la confirmación de ARCA, la prueba como mucho cada 15 minutos;
 * - si factura, crea las facturas que falten y manda las pendientes, de a una. Si ARCA no
 *   responde, corta ahí para no insistir con todas.
 */
export async function revisarFacturacion(
  base: BaseApp,
  kioscoId: string,
  estado: 'activa' | 'pendiente',
  f: Facturador,
): Promise<{ autorizados: number; pendientes: number }> {
  if (estado === 'pendiente') {
    const c = await withKiosco(base, kioscoId, (tx) =>
      tx.selectFrom('config_fiscal').select('verificada_en').executeTakeFirst(),
    );
    if (!c?.verificada_en || Date.now() - c.verificada_en.getTime() > 15 * 60_000)
      await verificarFacturacion(base, kioscoId, f);
    return { autorizados: 0, pendientes: 0 };
  }
  await crearComprobantesFaltantes(base, kioscoId, f);
  const pendientes = await comprobantesPendientes(base, kioscoId);
  let autorizados = 0;
  for (const id of pendientes.slice(0, 50)) {
    const r = await procesarComprobante(base, kioscoId, id, f);
    if (r.estado === 'autorizado') autorizados++;
    if (r.estado === 'reintentar' && r.caido) break;
  }
  return { autorizados, pendientes: pendientes.length - autorizados };
}
