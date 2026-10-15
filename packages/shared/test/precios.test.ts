import { describe, expect, it } from 'vitest';
import { aplicarAumento, parsearPesos, precioConMargen, redondearPrecio } from '../src/precios.ts';

describe('aplicarAumento', () => {
  it('aumenta y redondea al múltiplo más cercano', () => {
    expect(aplicarAumento(150000, 10, 1000)).toBe(165000); // $ 1.500 + 10 % = $ 1.650
    expect(aplicarAumento(123400, 10, 5000)).toBe(135000); // $ 1.357,40 → $ 1.350
    expect(aplicarAumento(123400, 10, 10000)).toBe(140000); // $ 1.357,40 → $ 1.400
    expect(aplicarAumento(99900, 7.5, 1000)).toBe(107000); // $ 1.073,93 → $ 1.070
  });
  it('acepta bajas de precio sin quedar negativo', () => {
    expect(aplicarAumento(100000, -20, 1000)).toBe(80000);
    expect(aplicarAumento(1000, -100, 1000)).toBe(0);
    // Algo barato nunca queda en $ 0 por el redondeo.
    expect(aplicarAumento(1000, 10, 5000)).toBe(5000);
  });
  it('rechaza precios no enteros', () => {
    expect(() => aplicarAumento(10.5, 10, 1000)).toThrow(RangeError);
  });
  it('precio con margen sobre el costo', () => {
    expect(precioConMargen(100000, 40)).toBe(140000);
  });
});

describe('parsearPesos', () => {
  it.each([
    ['1500', 150000],
    ['1.500', 150000],
    ['1500,50', 150050],
    ['1.500,5', 150050],
    ['$ 1.500', 150000],
    ['1500.50', 150050],
    ['0,99', 99],
    ['120.000', 12000000],
  ])('%s → %i', (texto, centavos) => {
    expect(parsearPesos(texto)).toBe(centavos);
  });
  it.each(['', 'abc', '1,2,3', '-5', '1.50.0'])('"%s" no se entiende', (texto) => {
    expect(parsearPesos(texto)).toBeNull();
  });
});

describe('redondearPrecio', () => {
  it('al más cercano, sin quedar en cero ni debajo del costo', () => {
    expect(redondearPrecio(123400, 5000)).toBe(125000);
    expect(redondearPrecio(1500, 5000)).toBe(5000); // $ 15 con paso de $ 50: $ 50, no $ 0
    expect(redondearPrecio(6600, 5000, 6000)).toBe(10000); // costo $ 60: no se vende a $ 50
    expect(redondearPrecio(6600, 1000, 6000)).toBe(7000);
    expect(redondearPrecio(0, 5000)).toBe(0);
  });
});
