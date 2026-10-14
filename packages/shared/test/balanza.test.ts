import { describe, expect, it } from 'vitest';
import { digitoVerificadorEan13, esEan13Valido, leerCodigoBalanza } from '../src/balanza.ts';

const conVerificador = (doce: string) => doce + digitoVerificadorEan13(doce);

describe('balanza', () => {
  it('valida el dígito verificador EAN-13', () => {
    expect(esEan13Valido('7790895000997')).toBe(true);
    expect(esEan13Valido('7790895000998')).toBe(false);
  });
  it('lee precio en pesos', () => {
    expect(leerCodigoBalanza(conVerificador('200012301500'))).toEqual({
      codigoProducto: '00123',
      precio: 150000,
    });
  });
  it('lee peso en gramos', () => {
    expect(
      leerCodigoBalanza(conVerificador('210004500750'), { valor: 'peso', decimalesPrecio: 0 }),
    ).toEqual({ codigoProducto: '00045', kilos: 0.75 });
  });
  it('ignora códigos que no son de balanza o están mal', () => {
    expect(leerCodigoBalanza('7790895000997')).toBeNull();
    expect(leerCodigoBalanza('2000123015001')).toBeNull();
  });
});
