import { describe, expect, it } from 'vitest';
import { centavosDesdePesos, formatearPlata } from '../src/dinero.ts';

describe('formatearPlata', () => {
  it('muestra pesos sin decimales cuando son cero', () => {
    expect(formatearPlata(150000)).toBe('$ 1.500');
    expect(formatearPlata(15300000)).toBe('$ 153.000');
    expect(formatearPlata(0)).toBe('$ 0');
  });

  it('muestra centavos cuando los hay', () => {
    expect(formatearPlata(150050)).toBe('$ 1.500,50');
    expect(formatearPlata(5)).toBe('$ 0,05');
  });

  it('muestra negativos', () => {
    expect(formatearPlata(-50000)).toBe('-$ 500');
  });

  it('rechaza montos que no son enteros', () => {
    expect(() => formatearPlata(10.5)).toThrow(RangeError);
    expect(() => formatearPlata(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('centavosDesdePesos', () => {
  it('convierte pesos enteros', () => {
    expect(centavosDesdePesos(1000)).toBe(100000);
  });
  it('rechaza decimales', () => {
    expect(() => centavosDesdePesos(1.5)).toThrow(RangeError);
  });
});
