import { describe, expect, it } from 'vitest';
import { ErrorPlanilla, leerXlsx } from '../src/xlsx.ts';

// Planilla de prueba (zip con deflate): título, fila vacía, encabezado con una columna salteada,
// textos compartidos con formato, texto en línea, entidades y la hoja con un nombre que no es
// sheet1.xml. Generada con el zipfile de Python.
const XLSX =
  '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';
const archivo = () => Uint8Array.from(atob(XLSX), (c) => c.charCodeAt(0));

describe('leerXlsx', () => {
  it('lee la primera hoja del libro con textos compartidos, en línea y números', async () => {
    const filas = await leerXlsx(archivo());
    expect(filas).toEqual([
      ['DISTRIBUIDORA SUR - LISTA DE PRECIOS'],
      [],
      ['Código', 'Descripción', '', 'Precio lista'],
      ['SUR-11872', 'Cable unipolar 2,5 mm² rojo', '', '1060.5'],
      ['20410', 'Llave & toma "armada"', 'x', '2780'],
    ]);
  });

  it('avisa si no es una planilla', async () => {
    await expect(leerXlsx(new TextEncoder().encode('nombre;precio\n'))).rejects.toThrow(
      ErrorPlanilla,
    );
  });

  it('corta si la planilla es demasiado grande', async () => {
    await expect(leerXlsx(archivo(), 2)).rejects.toThrow(/más de 2 filas/);
  });
});
