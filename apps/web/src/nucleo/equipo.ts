// Configuración de este equipo (no del kiosco): impresora y balanza. Se guarda en localStorage.
import { FORMATO_BALANZA_DEFECTO, type FormatoBalanza } from '@mostrador/shared';
import { useSyncExternalStore } from 'react';

export interface ConfigEquipo {
  anchoTicket: '58' | '80';
  imprimirAlCobrar: boolean;
  /** Dónde sale la factura al cobrar: en la impresora de tickets o en hoja A4 (o PDF). */
  formatoFactura: 'ticket' | 'hoja';
  balanza: FormatoBalanza & { activa: boolean };
}

const CLAVE = 'mostrador.equipo';
const DEFECTO: ConfigEquipo = {
  anchoTicket: '58',
  imprimirAlCobrar: false,
  formatoFactura: 'ticket',
  balanza: { ...FORMATO_BALANZA_DEFECTO, activa: true },
};

function leer(): ConfigEquipo {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as Partial<ConfigEquipo> | null;
    return { ...DEFECTO, ...g, balanza: { ...DEFECTO.balanza, ...g?.balanza } };
  } catch {
    return DEFECTO;
  }
}

let config = leer();
const oyentes = new Set<() => void>();

export function guardarEquipo(c: ConfigEquipo): void {
  config = c;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(c));
  } catch {
    // sin almacenamiento
  }
  aplicarAnchoTicket();
  for (const o of oyentes) o();
}

let hoja: CSSStyleSheet | null = null;
/** Tamaño de página para la impresora térmica (58 u 80 mm). */
export function aplicarAnchoTicket(): void {
  try {
    hoja ??= new CSSStyleSheet();
    hoja.replaceSync(`@media print { @page { size: ${config.anchoTicket}mm auto; margin: 0; } }`);
    if (!document.adoptedStyleSheets.includes(hoja))
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, hoja];
  } catch {
    // Navegadores viejos: queda el tamaño de la impresora.
  }
}

/**
 * Imprime en hoja A4 (presupuestos, facturas en hoja): mientras dura la impresión, la página es
 * A4 con márgenes en vez del ancho del ticket. `clase` va en <html> para mostrar lo que se imprime.
 */
export function imprimirEnHoja(clase: string): void {
  const raiz = document.documentElement;
  try {
    hoja ??= new CSSStyleSheet();
    hoja.replaceSync('@media print { @page { size: A4; margin: 12mm; } }');
    if (!document.adoptedStyleSheets.includes(hoja))
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, hoja];
  } catch {
    // Navegadores viejos: queda el tamaño que elija la impresora.
  }
  raiz.classList.add(clase);
  window.addEventListener(
    'afterprint',
    () => {
      raiz.classList.remove(clase);
      aplicarAnchoTicket();
    },
    { once: true },
  );
  window.print();
}

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};
export const useEquipo = () => useSyncExternalStore(suscribir, () => config);
export const configEquipo = () => config;
