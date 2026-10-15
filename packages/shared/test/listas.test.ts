import { describe, expect, it } from 'vitest';
import { detectarColumnas, precioDeCelda, renglonesDeLista } from '../src/listas.ts';

const filas = [
  ['DISTRIBUIDORA SUR - LISTA DE PRECIOS'],
  [],
  ['Cód. Art.', 'Descripción', 'Marca', 'Precio Lista'],
  ['SUR-11872', 'Cable unipolar 2,5 mm² rojo', 'X', '1060.5'],
  ['20410', 'Llave de luz armada', '', '2780'],
  ['', 'Subtotal sección', '', ''],
  ['SUR-99', 'Sin precio', '', 'consultar'],
];

describe('listas de proveedores', () => {
  it('encuentra el encabezado y las columnas aunque arriba haya un título', () => {
    expect(detectarColumnas(filas)).toEqual({
      encabezado: 2,
      codigo: 0,
      descripcion: 1,
      precio: 3,
    });
    expect(detectarColumnas([['Nombre', 'Importe']])).toBeNull();
  });

  it('lee precios crudos de Excel y escritos a mano de un CSV', () => {
    expect(precioDeCelda('1060.5', 'xlsx')).toBe(106050);
    expect(precioDeCelda('2780', 'xlsx')).toBe(278000);
    expect(precioDeCelda('1.060', 'csv')).toBe(106000);
    expect(precioDeCelda('$ 1.060,50', 'csv')).toBe(106050);
    expect(precioDeCelda('consultar', 'csv')).toBeNull();
  });

  it('arma los renglones y cuenta los descartados', () => {
    const col = detectarColumnas(filas)!;
    expect(renglonesDeLista(filas, col, 'xlsx')).toEqual({
      renglones: [
        { codigo: 'SUR-11872', descripcion: 'Cable unipolar 2,5 mm² rojo', costo: 106050 },
        { codigo: '20410', descripcion: 'Llave de luz armada', costo: 278000 },
      ],
      descartados: 2,
    });
  });
});
