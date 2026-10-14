// Unidades de venta (etapa I2, docs/decisiones/009-rubros.md). El stock y las cantidades se
// guardan con hasta 3 decimales (numeric(12, 3)); la plata siempre en centavos.

export const UNIDADES = ['unidad', 'metro', 'kilo', 'litro', 'caja'] as const;
export type Unidad = (typeof UNIDADES)[number];

export interface DatosUnidad {
  id: Unidad;
  /** "Unidad", "Metro"... para elegir en el producto. */
  nombre: string;
  /** Abreviatura que va al lado de la cantidad: "12,5 m". */
  corta: string;
  /** "¿Cuántos metros?" */
  pregunta: string;
  /** Con decimales se vende fraccionado (cable, fiambre, pintura suelta). */
  decimales: 0 | 2 | 3;
  /** "el metro", "el kilo": para mostrar el precio. */
  precioPor: string;
}

export const DATOS_UNIDADES: Record<Unidad, DatosUnidad> = {
  unidad: {
    id: 'unidad',
    nombre: 'Unidad',
    corta: 'u',
    pregunta: '¿Cuántas unidades?',
    decimales: 0,
    precioPor: 'c/u',
  },
  metro: {
    id: 'metro',
    nombre: 'Metro',
    corta: 'm',
    pregunta: '¿Cuántos metros?',
    decimales: 2,
    precioPor: 'el metro',
  },
  kilo: {
    id: 'kilo',
    nombre: 'Kilo',
    corta: 'kg',
    pregunta: '¿Cuántos kilos?',
    decimales: 3,
    precioPor: 'el kilo',
  },
  litro: {
    id: 'litro',
    nombre: 'Litro',
    corta: 'l',
    pregunta: '¿Cuántos litros?',
    decimales: 2,
    precioPor: 'el litro',
  },
  caja: {
    id: 'caja',
    nombre: 'Caja',
    corta: 'caja',
    pregunta: '¿Cuántas cajas?',
    decimales: 0,
    precioPor: 'la caja',
  },
};

export function esUnidad(valor: unknown): valor is Unidad {
  return UNIDADES.includes(valor as Unidad);
}

/** true si la unidad se vende con decimales (metro, kilo, litro). */
export function seFracciona(unidad: Unidad | null | undefined): boolean {
  return !!unidad && DATOS_UNIDADES[unidad].decimales > 0;
}

const FORMATO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 });

/** "12,5 m", "0,75 kg", "2 cajas", "3" (sin unidad o por unidad, solo el número). */
export function formatearCantidad(cantidad: number, unidad?: Unidad | null): string {
  const n = FORMATO.format(cantidad);
  if (!unidad || unidad === 'unidad') return n;
  if (unidad === 'caja') return `${n} ${cantidad === 1 ? 'caja' : 'cajas'}`;
  return `${n} ${DATOS_UNIDADES[unidad].corta}`;
}

/**
 * Lee lo que se escribe en el mostrador: "12,5", "12.5", "0,750", "½". Devuelve null si no es
 * una cantidad válida para la unidad (mayor que cero, con los decimales que admite).
 */
export function parsearCantidad(texto: string, unidad: Unidad = 'unidad'): number | null {
  const t = texto.trim().replace(/\s+/g, '').replace('½', '.5').replace(',', '.');
  if (!/^\d{0,6}(\.\d{1,3})?$/.test(t) || t === '' || t === '.') return null;
  const n = Number(t.startsWith('.') ? `0${t}` : t);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = DATOS_UNIDADES[unidad].decimales;
  if (Math.round(n * 10 ** d) / 10 ** d !== n) return null;
  return n;
}
