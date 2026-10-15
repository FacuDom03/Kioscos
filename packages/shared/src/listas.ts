// Listas de precios de proveedores (etapa I3): encontrar las columnas y leer los precios.
import { normalizar } from './busqueda.ts';
import { parsearPesos } from './precios.ts';

export interface Columnas {
  /** Índice de la fila de encabezado (las de arriba suelen ser el título de la lista). */
  encabezado: number;
  codigo: number;
  descripcion: number;
  precio: number;
}

const PISTAS = {
  codigo: ['codigo', 'cod', 'cod art', 'articulo', 'art', 'sku', 'referencia', 'ref', 'item'],
  descripcion: ['descripcion', 'detalle', 'producto', 'nombre', 'articulo'],
  precio: [
    'precio',
    'costo',
    'lista',
    'neto',
    'importe',
    'valor',
    'pcio',
    'p lista',
    'precio lista',
  ],
} as const;

function buscarColumna(celdas: string[], pistas: readonly string[], salvo: number[]): number {
  // Primero coincidencia exacta, después que empiece con la pista.
  for (const exacta of [true, false]) {
    for (const pista of pistas) {
      const i = celdas.findIndex(
        (c, j) => !salvo.includes(j) && (exacta ? c === pista : c.startsWith(`${pista} `)),
      );
      if (i >= 0) return i;
    }
  }
  return -1;
}

/** Busca la fila de encabezado y las columnas de código, descripción y precio. */
export function detectarColumnas(filas: string[][]): Columnas | null {
  for (let f = 0; f < Math.min(filas.length, 30); f++) {
    const celdas = (filas[f] ?? []).map((c) => normalizar(c));
    const codigo = buscarColumna(celdas, PISTAS.codigo, []);
    if (codigo < 0) continue;
    const precio = buscarColumna(celdas, PISTAS.precio, [codigo]);
    if (precio < 0) continue;
    const descripcion = buscarColumna(celdas, PISTAS.descripcion, [codigo, precio]);
    return { encabezado: f, codigo, descripcion, precio };
  }
  return null;
}

/**
 * Precio de una celda, en centavos. En un .xlsx los números vienen crudos ("1060.5"); en un CSV
 * vienen como los escribe una persona ("$ 1.060,50"). Devuelve null si no se entiende.
 */
export function precioDeCelda(texto: string, origen: 'xlsx' | 'csv'): number | null {
  const t = texto.trim();
  if (!t) return null;
  if (origen === 'xlsx' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(t)) {
    const n = Math.round(Number(t) * 100);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }
  return parsearPesos(t);
}

export interface Renglon {
  codigo: string;
  descripcion: string;
  /** Precio del proveedor, en centavos (antes de bonificación e IVA). */
  costo: number;
}

/** Renglones válidos de la lista y cuántos se descartaron (sin código o sin precio). */
export function renglonesDeLista(
  filas: string[][],
  col: Columnas,
  origen: 'xlsx' | 'csv',
): { renglones: Renglon[]; descartados: number } {
  const renglones: Renglon[] = [];
  let descartados = 0;
  for (const fila of filas.slice(col.encabezado + 1)) {
    if (fila.every((c) => !c?.trim())) continue;
    const codigo = (fila[col.codigo] ?? '').trim().slice(0, 60);
    const costo = precioDeCelda(fila[col.precio] ?? '', origen);
    if (!codigo || costo === null) {
      descartados++;
      continue;
    }
    renglones.push({
      codigo,
      descripcion: col.descripcion >= 0 ? (fila[col.descripcion] ?? '').trim().slice(0, 120) : '',
      costo,
    });
  }
  return { renglones, descartados };
}
