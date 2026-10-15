import { describe, expect, it } from 'vitest';
import { filasDeXlsxParaImportar, planillaModelo } from '../src/importar.ts';
import { escribirXlsx } from '../src/xlsx-escribir.ts';
import { leerXlsx } from '../src/xlsx.ts';

describe('planilla modelo', () => {
  it('se vuelve a leer igual: encabezado y ejemplos', async () => {
    const hojas = planillaModelo({
      rubro: 'kiosco',
      unidades: false,
      ubicaciones: false,
      gremio: false,
    });
    const filas = await leerXlsx(escribirXlsx(hojas));
    expect(filas[0]).toEqual([
      'Nombre',
      'Precio',
      'Código',
      'Categoría',
      'Costo',
      'Stock',
      'Mínimo',
    ]);
    expect(filas[1]).toEqual([
      'Alfajor triple chocolate',
      '1500',
      '7790580123459',
      'Golosinas',
      '950',
      '24',
      '6',
    ]);
    // El que no tiene código deja la celda vacía.
    expect(filas[3]?.[2]).toBe('');
  });

  it('suma las columnas de las funciones activas', async () => {
    const hojas = planillaModelo({
      rubro: 'ferreteria',
      unidades: true,
      ubicaciones: true,
      gremio: true,
    });
    const filas = await leerXlsx(escribirXlsx(hojas));
    expect(filas[0]?.slice(7)).toEqual(['Unidad', 'Ubicación', 'Precio gremio']);
    expect(filas[1]?.[7]).toBe('metro');
    expect(hojas[1]?.nombre).toBe('Cómo llenarla');
  });

  it('escapa los textos', async () => {
    const xlsx = escribirXlsx([{ nombre: 'A', filas: [['x'], ['<Tornillo & "tuerca">']] }]);
    expect((await leerXlsx(xlsx))[1]).toEqual(['<Tornillo & "tuerca">']);
  });
});

describe('filasDeXlsxParaImportar', () => {
  it('pasa los números de Excel a como se escriben acá', () => {
    const filas = filasDeXlsxParaImportar([
      ['Nombre', 'Precio', 'Código', 'Stock', 'Precio gremio'],
      ['Cable', '1450.5', '7.790895000997E12', '12.5', '1299.999999'],
      ['1500', '1500', 'ABC-1', '3', ''],
    ]);
    expect(filas[1]).toEqual(['Cable', '1450,5', '7790895000997', '12,5', '1300']);
    expect(filas[2]).toEqual(['1500', '1500', 'ABC-1', '3', '']);
  });
});
