// Aumento masivo de precios (sección 11 de docs/SPEC.md). Todo en centavos enteros.

export type Redondeo = 1000 | 5000 | 10000; // al $ 10, $ 50 o $ 100 más cercano

/**
 * Aplica un porcentaje (puede tener hasta 2 decimales, por ejemplo 7,5) y redondea al múltiplo
 * más cercano. Nunca devuelve un precio negativo.
 */
export function aplicarAumento(precio: number, porcentaje: number, redondeo: Redondeo): number {
  if (!Number.isSafeInteger(precio) || precio < 0) throw new RangeError('Precio inválido');
  const basisPoints = Math.round(porcentaje * 100); // 7,5 % → 750
  const nuevo = Math.round((precio * (10_000 + basisPoints)) / 10_000);
  return redondearPrecio(nuevo, redondeo);
}

/**
 * Redondea al múltiplo más cercano de `paso`. Algo que vale más de cero nunca queda en $ 0, y si
 * se pasa un `piso` (el costo), nunca queda por debajo: en esos casos redondea para arriba.
 */
export function redondearPrecio(valor: number, paso: number, piso = 0): number {
  if (valor <= 0) return 0;
  const cercano = Math.round(valor / paso) * paso;
  return cercano > 0 && cercano >= piso ? cercano : Math.ceil(Math.max(valor, piso) / paso) * paso;
}

/** Precio de venta a partir del costo y un margen en porcentaje, redondeado. */
export function precioConMargen(costo: number, margen: number, redondeo: Redondeo = 1000): number {
  return aplicarAumento(costo, margen, redondeo);
}

/**
 * Lee un monto en pesos escrito por una persona y lo devuelve en centavos.
 * Acepta "1500", "1.500", "1500,50", "1.500,50", "$ 1.500" y "1500.50" (punto decimal si hay
 * exactamente dos decimales). Devuelve null si no se entiende.
 */
export function parsearPesos(texto: string): number | null {
  let t = texto.replace(/\$|\s/g, '');
  if (!t) return null;
  if (/^\d+\.\d{2}$/.test(t)) t = t.replace('.', ',');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(t)) return null;
  const [entero = '0', dec = ''] = t.replace(/\./g, '').split(',');
  const centavos = Number(entero) * 100 + Number(dec.padEnd(2, '0'));
  return Number.isSafeInteger(centavos) ? centavos : null;
}
