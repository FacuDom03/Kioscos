import { describe, expect, it } from 'vitest';
import { formatearCantidad, parsearCantidad, seFracciona } from '../src/unidades.ts';

describe('unidades', () => {
  it('muestra la cantidad con su unidad, en castellano', () => {
    expect(formatearCantidad(12.5, 'metro')).toBe('12,5 m');
    expect(formatearCantidad(0.75, 'kilo')).toBe('0,75 kg');
    expect(formatearCantidad(1, 'caja')).toBe('1 caja');
    expect(formatearCantidad(3, 'caja')).toBe('3 cajas');
    expect(formatearCantidad(2, 'unidad')).toBe('2');
    expect(formatearCantidad(1500)).toBe('1.500');
  });

  it('lee cantidades con coma, punto o medio', () => {
    expect(parsearCantidad('12,5', 'metro')).toBe(12.5);
    expect(parsearCantidad('12.5', 'metro')).toBe(12.5);
    expect(parsearCantidad('0,750', 'kilo')).toBe(0.75);
    expect(parsearCantidad(',5', 'kilo')).toBe(0.5);
    expect(parsearCantidad('½', 'litro')).toBe(0.5);
    expect(parsearCantidad('3', 'caja')).toBe(3);
  });

  it('rechaza lo que no es una cantidad válida para la unidad', () => {
    expect(parsearCantidad('0', 'metro')).toBeNull();
    expect(parsearCantidad('-1', 'metro')).toBeNull();
    expect(parsearCantidad('abc', 'metro')).toBeNull();
    expect(parsearCantidad('1,5', 'unidad')).toBeNull();
    expect(parsearCantidad('1,255', 'metro')).toBeNull();
    expect(parsearCantidad('0,125', 'kilo')).toBe(0.125);
    expect(parsearCantidad('', 'kilo')).toBeNull();
  });

  it('metro, kilo y litro se fraccionan; unidad y caja no', () => {
    expect(seFracciona('metro')).toBe(true);
    expect(seFracciona('kilo')).toBe(true);
    expect(seFracciona('unidad')).toBe(false);
    expect(seFracciona('caja')).toBe(false);
    expect(seFracciona(null)).toBe(false);
  });
});
