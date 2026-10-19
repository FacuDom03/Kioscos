import { describe, expect, it } from 'vitest';
import {
  camposDelComprobante,
  cuitValido,
  desgloseIva,
  hayQueIdentificar,
  importeArca,
  normalizarNumeroComprobante,
  notaDeCredito,
  numeroVisible,
  tipoDeFactura,
  urlQrArca,
  type DatosComprobante,
} from '../src/factura.ts';

describe('cuitValido', () => {
  it('acepta CUIT con el dígito verificador correcto', () => {
    expect(cuitValido('20409378472')).toBe(true); // CUIT de pruebas de los ejemplos de ARCA
    expect(cuitValido('30000000007')).toBe(true); // el del ejemplo del QR
  });
  it('rechaza errores de tipeo y formatos raros', () => {
    expect(cuitValido('20409378473')).toBe(false);
    expect(cuitValido('20409378742')).toBe(false); // dos dígitos cambiados de lugar
    expect(cuitValido('2040937847')).toBe(false);
    expect(cuitValido('20-40937847-2')).toBe(false);
    expect(cuitValido('')).toBe(false);
  });
});

describe('tipoDeFactura', () => {
  it('el monotributista y el exento hacen siempre C', () => {
    for (const r of ['consumidor_final', 'responsable_inscripto', 'monotributo'] as const) {
      expect(tipoDeFactura('monotributo', r)).toBe('factura_c');
      expect(tipoDeFactura('exento', r)).toBe('factura_c');
    }
  });
  it('el responsable inscripto hace A a inscriptos y monotributistas, B al resto', () => {
    expect(tipoDeFactura('responsable_inscripto', 'responsable_inscripto')).toBe('factura_a');
    expect(tipoDeFactura('responsable_inscripto', 'monotributo')).toBe('factura_a');
    expect(tipoDeFactura('responsable_inscripto', 'consumidor_final')).toBe('factura_b');
    expect(tipoDeFactura('responsable_inscripto', 'exento')).toBe('factura_b');
  });
  it('la nota de crédito es de la misma letra', () => {
    expect(notaDeCredito('factura_a')).toBe('nota_credito_a');
    expect(notaDeCredito('factura_b')).toBe('nota_credito_b');
    expect(notaDeCredito('factura_c')).toBe('nota_credito_c');
  });
});

describe('importes y números', () => {
  it('pasa centavos al formato de ARCA sin perder un centavo', () => {
    expect(importeArca(12345)).toBe('123.45');
    expect(importeArca(5)).toBe('0.05');
    expect(importeArca(100000000000)).toBe('1000000000.00');
    expect(importeArca(-1005)).toBe('-10.05');
    expect(() => importeArca(10.5)).toThrow(RangeError);
  });
  it('número de comprobante como se imprime', () => {
    expect(numeroVisible(3, 124)).toBe('00003-00000124');
  });
  it('acepta el número de comprobante como lo escriba la persona', () => {
    expect(normalizarNumeroComprobante('3-124')).toBe('00003-00000124');
    expect(normalizarNumeroComprobante(' 0003-00000124 ')).toBe('00003-00000124');
    expect(normalizarNumeroComprobante('00003 00000124')).toBe('00003-00000124');
    expect(normalizarNumeroComprobante('124')).toBeNull();
    expect(normalizarNumeroComprobante('0-124')).toBeNull();
    expect(normalizarNumeroComprobante('A-0003-124')).toBeNull();
  });
  it('identificar al consumidor final desde $ 10.000.000', () => {
    expect(hayQueIdentificar(999_999_999, 'consumidor_final')).toBe(false);
    expect(hayQueIdentificar(1_000_000_000, 'consumidor_final')).toBe(true);
    expect(hayQueIdentificar(5_000_000_000, 'monotributo')).toBe(false);
  });
});

describe('desgloseIva', () => {
  it('separa el IVA y neto más IVA da el total exacto', () => {
    const d = desgloseIva([
      { subtotal: 121000, alicuota: 21 },
      { subtotal: 110500, alicuota: 10.5 },
      { subtotal: 999, alicuota: 21 },
    ]);
    expect(d.porAlicuota).toEqual([
      { alicuota: 10.5, codigo: 4, base: 100000, importe: 10500 },
      { alicuota: 21, codigo: 5, base: 100826, importe: 21173 }, // 121.999 / 1,21 = 100.825,6
    ]);
    expect(d.neto + d.iva).toBe(121000 + 110500 + 999);
  });
  it('redondea bien en montos chicos y grandes', () => {
    for (const total of [1, 99, 12345, 987654321, 123456789012]) {
      const d = desgloseIva([{ subtotal: total, alicuota: 21 }]);
      expect(d.neto + d.iva).toBe(total);
      expect(Math.abs(d.neto * 0.21 - d.iva)).toBeLessThanOrEqual(1);
    }
  });
  it('rechaza alícuotas inexistentes y totales negativos', () => {
    expect(() => desgloseIva([{ subtotal: 100, alicuota: 19 as 21 }])).toThrow(RangeError);
    expect(() => desgloseIva([{ subtotal: -100, alicuota: 21 }])).toThrow(RangeError);
  });
});

const facturaC: DatosComprobante = {
  emisor: 'monotributo',
  tipo: 'factura_c',
  puntoDeVenta: 3,
  numero: 124,
  fecha: '2026-10-18',
  comprador: { condicion: 'consumidor_final' },
  lineas: [
    { subtotal: 180000, alicuota: 21 },
    { subtotal: 90050, alicuota: 21 },
  ],
};

describe('camposDelComprobante', () => {
  it('factura C a consumidor final: sin IVA ni documento', () => {
    expect(camposDelComprobante(facturaC)).toEqual({
      CbteTipo: 11,
      PtoVta: 3,
      Concepto: 1,
      DocTipo: 99,
      DocNro: '0',
      CbteDesde: 124,
      CbteHasta: 124,
      CbteFch: '20261018',
      ImpTotal: '2700.50',
      ImpTotConc: '0.00',
      ImpNeto: '2700.50',
      ImpOpEx: '0.00',
      ImpTrib: '0.00',
      ImpIVA: '0.00',
      MonId: 'PES',
      MonCotiz: '1',
      CondicionIVAReceptorId: 5,
    });
  });

  it('factura B de un responsable inscripto: detalle de IVA que suma el total', () => {
    const c = camposDelComprobante({
      ...facturaC,
      emisor: 'responsable_inscripto',
      tipo: 'factura_b',
    });
    expect(c.CbteTipo).toBe(6);
    expect(c.ImpTotal).toBe('2700.50');
    expect(c.ImpNeto).toBe('2231.82');
    expect(c.ImpIVA).toBe('468.68');
    expect(c.Iva).toEqual([{ Id: 5, BaseImp: '2231.82', Importe: '468.68' }]);
  });

  it('factura A con el CUIT del comprador', () => {
    const c = camposDelComprobante({
      ...facturaC,
      emisor: 'responsable_inscripto',
      tipo: 'factura_a',
      comprador: {
        condicion: 'responsable_inscripto',
        documento: { tipo: 'cuit', numero: '30000000007' },
      },
    });
    expect(c).toMatchObject({ CbteTipo: 1, DocTipo: 80, DocNro: '30000000007' });
    expect(c.CondicionIVAReceptorId).toBe(1);
  });

  it('nota de crédito C que anula una factura', () => {
    const c = camposDelComprobante({
      ...facturaC,
      tipo: 'nota_credito_c',
      numero: 7,
      anula: { tipo: 'factura_c', puntoDeVenta: 3, numero: 124, cuitEmisor: '20409378472' },
    });
    expect(c.CbteTipo).toBe(13);
    expect(c.CbtesAsoc).toEqual([{ Tipo: 11, PtoVta: 3, Nro: 124, Cuit: '20409378472' }]);
  });

  it('rechaza con palabras lo que ARCA rechazaría', () => {
    const mal = (cambio: Partial<DatosComprobante>) => () =>
      camposDelComprobante({ ...facturaC, ...cambio });
    expect(mal({ tipo: 'factura_b' })).toThrow('solo hace comprobantes C');
    expect(mal({ emisor: 'responsable_inscripto', tipo: 'factura_a' })).toThrow(
      'corresponde un comprobante B',
    );
    expect(
      mal({
        emisor: 'responsable_inscripto',
        tipo: 'factura_a',
        comprador: { condicion: 'monotributo' },
      }),
    ).toThrow('necesita el CUIT');
    expect(
      mal({
        comprador: {
          condicion: 'consumidor_final',
          documento: { tipo: 'cuit', numero: '30000000008' },
        },
      }),
    ).toThrow('CUIT del comprador no es válido');
    expect(mal({ lineas: [{ subtotal: 1_000_000_000, alicuota: 21 }] })).toThrow(
      'cargar el documento',
    );
    expect(
      mal({
        lineas: [{ subtotal: 1_000_000_000, alicuota: 21 }],
        comprador: {
          condicion: 'consumidor_final',
          documento: { tipo: 'dni', numero: '30123456' },
        },
      }),
    ).not.toThrow();
    expect(mal({ tipo: 'nota_credito_c' })).toThrow('necesita la factura que anula');
    expect(mal({ lineas: [] })).toThrow('mayor a cero');
    expect(mal({ puntoDeVenta: 0 })).toThrow('punto de venta');
  });
});

describe('urlQrArca', () => {
  it('arma el QR con los datos del comprobante en base64', () => {
    const url = urlQrArca({
      fecha: '2026-10-18',
      cuitEmisor: '30000000007',
      puntoDeVenta: 10,
      tipo: 'factura_a',
      numero: 94,
      totalCentavos: 1210000,
      comprador: { tipo: 'cuit', numero: '20409378472' },
      cae: '70417054367476',
    });
    expect(url.startsWith('https://www.afip.gob.ar/fe/qr/?p=')).toBe(true);
    const datos: unknown = JSON.parse(atob(url.split('?p=')[1]!));
    expect(datos).toEqual({
      ver: 1,
      fecha: '2026-10-18',
      cuit: 30000000007,
      ptoVta: 10,
      tipoCmp: 1,
      nroCmp: 94,
      importe: 12100,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 20409378472,
      tipoCodAut: 'E',
      codAut: 70417054367476,
    });
  });
  it('sin datos del comprador cuando es consumidor final sin identificar', () => {
    const url = urlQrArca({
      fecha: '2026-10-18',
      cuitEmisor: '20409378472',
      puntoDeVenta: 3,
      tipo: 'factura_c',
      numero: 124,
      totalCentavos: 270050,
      comprador: { tipo: 'sin_identificar', numero: '0' },
      cae: '70417054367476',
    });
    const datos = JSON.parse(atob(url.split('?p=')[1]!)) as Record<string, unknown>;
    expect(datos['importe']).toBe(2700.5);
    expect('tipoDocRec' in datos).toBe(false);
  });
});
