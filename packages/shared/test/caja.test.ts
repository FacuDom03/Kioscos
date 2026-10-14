import { describe, expect, it } from 'vitest';
import {
  deberiaHaber,
  diferenciaEnPalabras,
  montosRapidos,
  subtotal,
  vuelto,
} from '../src/caja.ts';
import { formatearPlata } from '../src/dinero.ts';

describe('venta', () => {
  it('subtotal redondea al centavo', () => {
    expect(subtotal(3, 120000)).toBe(360000);
    expect(subtotal(0.333, 100000)).toBe(33300);
  });
  it('vuelto', () => {
    expect(vuelto(153000, 200000)).toBe(47000);
    expect(vuelto(153000, 153000)).toBe(0);
    expect(vuelto(153000, 100000)).toBeNull();
  });
  it('montos rápidos que alcanzan', () => {
    expect(montosRapidos(150000)).toEqual([200000, 1000000, 2000000]);
    expect(montosRapidos(50000)).toEqual([100000, 200000, 1000000, 2000000]);
  });
});

describe('cierre de caja', () => {
  it('debería haber = cambio + efectivo − gastos', () => {
    expect(
      deberiaHaber({ cambioInicial: 1000000, efectivoCobrado: 8500000, gastosYRetiros: 250000 }),
    ).toBe(9250000);
  });
  it('diferencia en palabras', () => {
    expect(diferenciaEnPalabras(9200000, 9250000, formatearPlata)).toBe('Faltan $ 500');
    expect(diferenciaEnPalabras(9270000, 9250000, formatearPlata)).toBe('Sobran $ 200');
    expect(diferenciaEnPalabras(9250000, 9250000, formatearPlata)).toBe('Da justo');
  });
});
