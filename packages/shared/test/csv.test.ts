import { describe, expect, it } from 'vitest';
import { armarCsv, leerCsv } from '../src/csv.ts';

describe('CSV', () => {
  it('lee con punto y coma y comillas', () => {
    expect(leerCsv('nombre;precio\n"Alfajor ""triple""";1.200\r\nCoca;1800\n\n')).toEqual([
      ['nombre', 'precio'],
      ['Alfajor "triple"', '1.200'],
      ['Coca', '1800'],
    ]);
  });
  it('lee con coma', () => {
    expect(leerCsv('a,b\n1,"x, y"')).toEqual([
      ['a', 'b'],
      ['1', 'x, y'],
    ]);
  });
  it('arma CSV seguro para Excel', () => {
    const csv = armarCsv([
      ['Producto', 'Total'],
      ['=HYPERLINK("malo")', 1500],
    ]);
    expect(csv).toBe('﻿Producto;Total\r\n"\'=HYPERLINK(""malo"")";1500\r\n');
  });
});
