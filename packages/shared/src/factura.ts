// Reglas de la factura electrónica de ARCA que no dependen de cómo se le habla a ARCA (conexión
// directa o un intermediario): qué comprobante corresponde, qué datos lleva, el QR y el desglose
// de IVA. Ver docs/FACTURACION.md y docs/decisiones/010-facturacion-arca.md.

/** Condición frente al IVA de quien vende. */
export type CondicionEmisor = 'monotributo' | 'responsable_inscripto' | 'exento';

/** Condición frente al IVA de quien compra, con su código de ARCA (`CondicionIVAReceptorId`). */
export const CONDICION_RECEPTOR = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributo: 6,
} as const;
export type CondicionReceptor = keyof typeof CONDICION_RECEPTOR;

/** Códigos de comprobante de ARCA (`CbteTipo`). */
export const TIPO_COMPROBANTE = {
  factura_a: 1,
  nota_credito_a: 3,
  factura_b: 6,
  nota_credito_b: 8,
  factura_c: 11,
  nota_credito_c: 13,
} as const;
export type TipoComprobante = keyof typeof TIPO_COMPROBANTE;
export type TipoFactura = 'factura_a' | 'factura_b' | 'factura_c';

/** Comprobantes que se cargan en una compra, en palabras. */
export const COMPROBANTES_COMPRA = {
  factura_a: 'Factura A',
  factura_b: 'Factura B',
  factura_c: 'Factura C',
  remito: 'Remito',
  ticket: 'Ticket',
  otro: 'Otro',
} as const;
export type ComprobanteCompra = keyof typeof COMPROBANTES_COMPRA;

/** Códigos de documento de ARCA (`DocTipo`). */
export const TIPO_DOCUMENTO = { cuit: 80, cuil: 86, dni: 96, sin_identificar: 99 } as const;
export type TipoDocumento = keyof typeof TIPO_DOCUMENTO;

/**
 * Desde este total (inclusive) hay que identificar al consumidor final con su documento:
 * $ 10.000.000 en centavos (RG 5866/2026, vigente desde el 1/7/2026).
 */
export const TOPE_IDENTIFICAR_CONSUMIDOR = 1_000_000_000;

/**
 * En modo de prueba todos los comercios facturan con el CUIT de pruebas de Afip SDK. Para no
 * chocar con el resto de sus usuarios (el punto de venta 1 está siempre ocupado), cada comercio
 * usa un punto de venta propio, fijo, sacado de su ID.
 */
export function puntoDeVentaDePrueba(kioscoId: string): number {
  let h = 0;
  for (const c of kioscoId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 2000 + (h % 7998);
}

/** Dirección del QR según la especificación de ARCA (verificar si pasa a arca.gob.ar). */
export const URL_QR_ARCA = 'https://www.afip.gob.ar/fe/qr/';

/** Alícuotas de IVA, en porcentaje. */
export type Alicuota = 0 | 2.5 | 5 | 10.5 | 21 | 27;
const CODIGO_ALICUOTA: Record<Alicuota, number> = { 0: 3, 2.5: 9, 5: 8, 10.5: 4, 21: 5, 27: 6 };

/** CUIT de 11 dígitos con el dígito verificador correcto. */
export function cuitValido(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(cuit[i]), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto;
  return verificador !== 10 && verificador === Number(cuit[10]);
}

/**
 * Qué factura corresponde. El monotributista y el exento hacen siempre C. El responsable
 * inscripto hace A a otro responsable inscripto o a un monotributista, y B al resto.
 */
export function tipoDeFactura(emisor: CondicionEmisor, receptor: CondicionReceptor): TipoFactura {
  if (emisor !== 'responsable_inscripto') return 'factura_c';
  return receptor === 'responsable_inscripto' || receptor === 'monotributo'
    ? 'factura_a'
    : 'factura_b';
}

/** La nota de crédito que anula una factura es de la misma letra. */
export function notaDeCredito(factura: TipoFactura): TipoComprobante {
  return `nota_credito_${letraDe(factura).toLowerCase()}` as TipoComprobante;
}

export function letraDe(tipo: TipoComprobante): 'A' | 'B' | 'C' {
  return tipo.slice(-1).toUpperCase() as 'A' | 'B' | 'C';
}

/**
 * Número de comprobante como lo escribe la persona ("3-124", "0003-00000124", "00003 00000124")
 * al formato de ARCA: `"00003-00000124"`. Null si no tiene la forma punto de venta-número.
 */
export function normalizarNumeroComprobante(texto: string): string | null {
  const m = /^\s*(\d{1,5})\s*[-\s]\s*(\d{1,8})\s*$/.exec(texto);
  if (!m?.[1] || !m[2] || Number(m[1]) < 1 || Number(m[2]) < 1) return null;
  return numeroVisible(Number(m[1]), Number(m[2]));
}

/** `(3, 124)` → `"00003-00000124"`, como se imprime en el comprobante. */
export function numeroVisible(puntoDeVenta: number, numero: number): string {
  return `${String(puntoDeVenta).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;
}

/** ¿Hay que pedir el documento del comprador antes de facturar? */
export function hayQueIdentificar(totalCentavos: number, receptor: CondicionReceptor): boolean {
  return receptor === 'consumidor_final' && totalCentavos >= TOPE_IDENTIFICAR_CONSUMIDOR;
}

/** Centavos al formato de importe de ARCA: `12345` → `"123.45"`. */
export function importeArca(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) throw new RangeError(`Monto inválido: ${centavos}`);
  const abs = Math.abs(centavos);
  const pesos = `${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return centavos < 0 ? `-${pesos}` : pesos;
}

export interface LineaIva {
  /** Importe de la línea con IVA incluido, en centavos (ya con descuentos). */
  subtotal: number;
  alicuota: Alicuota;
}

export interface Desglose {
  neto: number;
  iva: number;
  porAlicuota: { alicuota: Alicuota; codigo: number; base: number; importe: number }[];
}

/**
 * Separa el IVA de precios que lo traen incluido, agrupado por alícuota. El total de la venta
 * no cambia: neto + IVA da exactamente la suma de las líneas.
 */
export function desgloseIva(lineas: LineaIva[]): Desglose {
  const totales = new Map<Alicuota, number>();
  for (const l of lineas) {
    if (!Number.isSafeInteger(l.subtotal)) throw new RangeError(`Monto inválido: ${l.subtotal}`);
    if (!(l.alicuota in CODIGO_ALICUOTA)) throw new RangeError(`Alícuota inválida: ${l.alicuota}`);
    totales.set(l.alicuota, (totales.get(l.alicuota) ?? 0) + l.subtotal);
  }
  const porAlicuota = [...totales]
    .sort(([a], [b]) => a - b)
    .map(([alicuota, total]) => {
      if (total < 0) throw new RangeError('El total de una alícuota no puede ser negativo.');
      // base = total / (1 + alícuota), redondeado al centavo, en enteros para no perder nada.
      const divisor = BigInt(1000 + alicuota * 10);
      const base = Number((BigInt(total) * 2000n + divisor) / (divisor * 2n));
      return { alicuota, codigo: CODIGO_ALICUOTA[alicuota], base, importe: total - base };
    });
  return {
    neto: porAlicuota.reduce((s, a) => s + a.base, 0),
    iva: porAlicuota.reduce((s, a) => s + a.importe, 0),
    porAlicuota,
  };
}

export interface Comprador {
  condicion: CondicionReceptor;
  documento?: { tipo: TipoDocumento; numero: string };
}

export interface DatosComprobante {
  emisor: CondicionEmisor;
  tipo: TipoComprobante;
  puntoDeVenta: number;
  numero: number;
  /** Día del comprobante, AAAA-MM-DD (en la Argentina). */
  fecha: string;
  comprador: Comprador;
  /** Para A y B hace falta el detalle por alícuota; para C alcanza con el total. */
  lineas: LineaIva[];
  /** La factura que anula, si es una nota de crédito. */
  anula?: { tipo: TipoFactura; puntoDeVenta: number; numero: number; cuitEmisor: string };
}

/**
 * Los campos de un comprobante tal como los pide el servicio de facturación de ARCA
 * (`FECAEDetRequest` de WSFEv1), con los importes como texto. Rechaza con palabras claras lo
 * que ARCA rechazaría.
 */
export function camposDelComprobante(d: DatosComprobante) {
  const total = d.lineas.reduce((s, l) => s + l.subtotal, 0);
  if (total <= 0) throw new Error('El comprobante tiene que tener un importe mayor a cero.');
  if (!Number.isSafeInteger(d.numero) || d.numero < 1) throw new Error('Número inválido.');
  if (!Number.isSafeInteger(d.puntoDeVenta) || d.puntoDeVenta < 1 || d.puntoDeVenta > 99998)
    throw new Error('El punto de venta tiene que ser un número entre 1 y 99998.');

  const letra = letraDe(d.tipo);
  const deMonotributo = d.emisor !== 'responsable_inscripto';
  if (deMonotributo !== (letra === 'C'))
    throw new Error(
      deMonotributo
        ? 'Un monotributista o exento solo hace comprobantes C.'
        : 'Un responsable inscripto hace comprobantes A o B.',
    );
  const esperado = tipoDeFactura(d.emisor, d.comprador.condicion);
  if (letraDe(esperado) !== letra)
    throw new Error(`A este comprador le corresponde un comprobante ${letraDe(esperado)}.`);

  const documento = d.comprador.documento;
  const doc = documento?.tipo === 'sin_identificar' ? undefined : documento;
  if (letra === 'A' && doc?.tipo !== 'cuit')
    throw new Error('La factura A necesita el CUIT del comprador.');
  if (doc?.tipo === 'cuit' && !cuitValido(doc.numero))
    throw new Error('El CUIT del comprador no es válido.');
  if (doc && !/^\d{7,11}$/.test(doc.numero))
    throw new Error('El documento del comprador no es válido.');
  if (!doc && hayQueIdentificar(total, d.comprador.condicion))
    throw new Error('Desde $ 10.000.000 hay que cargar el documento del comprador.');

  const esNota = d.tipo.startsWith('nota_credito');
  if (esNota !== Boolean(d.anula))
    throw new Error(
      esNota
        ? 'La nota de crédito necesita la factura que anula.'
        : 'Solo una nota de crédito anula.',
    );
  if (d.anula && notaDeCredito(d.anula.tipo) !== d.tipo)
    throw new Error('La nota de crédito tiene que ser de la misma letra que la factura.');

  const desglose = letra === 'C' ? null : desgloseIva(d.lineas);
  return {
    CbteTipo: TIPO_COMPROBANTE[d.tipo],
    PtoVta: d.puntoDeVenta,
    Concepto: 1, // productos
    DocTipo: TIPO_DOCUMENTO[doc ? doc.tipo : 'sin_identificar'],
    DocNro: doc ? doc.numero : '0',
    CbteDesde: d.numero,
    CbteHasta: d.numero,
    CbteFch: d.fecha.replaceAll('-', ''),
    ImpTotal: importeArca(total),
    ImpTotConc: '0.00',
    ImpNeto: importeArca(desglose ? desglose.neto : total),
    ImpOpEx: '0.00',
    ImpTrib: '0.00',
    ImpIVA: importeArca(desglose ? desglose.iva : 0),
    MonId: 'PES',
    MonCotiz: '1',
    CondicionIVAReceptorId: CONDICION_RECEPTOR[d.comprador.condicion],
    ...(desglose
      ? {
          Iva: desglose.porAlicuota.map((a) => ({
            Id: a.codigo,
            BaseImp: importeArca(a.base),
            Importe: importeArca(a.importe),
          })),
        }
      : {}),
    ...(d.anula
      ? {
          CbtesAsoc: [
            {
              Tipo: TIPO_COMPROBANTE[d.anula.tipo],
              PtoVta: d.anula.puntoDeVenta,
              Nro: d.anula.numero,
              Cuit: d.anula.cuitEmisor,
            },
          ],
        }
      : {}),
  };
}

export interface DatosQr {
  /** AAAA-MM-DD */
  fecha: string;
  cuitEmisor: string;
  puntoDeVenta: number;
  tipo: TipoComprobante;
  numero: number;
  totalCentavos: number;
  comprador?: Comprador['documento'];
  /** El CAE que dio ARCA (14 dígitos). */
  cae: string;
}

/** El texto del QR que va impreso en el comprobante (especificación de ARCA, versión 1). */
export function urlQrArca(d: DatosQr): string {
  const doc = d.comprador?.tipo === 'sin_identificar' ? undefined : d.comprador;
  const datos = {
    ver: 1,
    fecha: d.fecha,
    cuit: Number(d.cuitEmisor),
    ptoVta: d.puntoDeVenta,
    tipoCmp: TIPO_COMPROBANTE[d.tipo],
    nroCmp: d.numero,
    importe: Number(importeArca(d.totalCentavos)),
    moneda: 'PES',
    ctz: 1,
    ...(doc ? { tipoDocRec: TIPO_DOCUMENTO[doc.tipo], nroDocRec: Number(doc.numero) } : {}),
    tipoCodAut: 'E',
    codAut: Number(d.cae),
  };
  return `${URL_QR_ARCA}?p=${btoa(JSON.stringify(datos))}`;
}
