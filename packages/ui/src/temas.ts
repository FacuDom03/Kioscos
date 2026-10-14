// Temas disponibles. El tema es por equipo: se guarda en localStorage y se aplica con
// `data-tema` en <html>. El script public/tema.js de la app hace lo mismo antes de pintar.

export const TEMAS = [
  {
    id: 'noche',
    nombre: 'Noche',
    descripcion: 'Oscuro. Cansa menos la vista con poca luz.',
    themeColor: '#111936',
  },
  {
    id: 'dia',
    nombre: 'Día',
    descripcion: 'Claro. Se lee mejor con sol o mucha luz.',
    themeColor: '#EEF1F5',
  },
  {
    id: 'pizarron',
    nombre: 'Pizarrón',
    descripcion: 'Verde oscuro, como la pizarra de precios.',
    themeColor: '#15302A',
  },
  {
    id: 'contraste',
    nombre: 'Alto contraste',
    descripcion: 'Blanco sobre negro, para leer sin esfuerzo.',
    themeColor: '#000000',
  },
] as const;

export type Tema = (typeof TEMAS)[number]['id'];

export const CLAVE_TEMA = 'mostrador.tema';
export const TEMA_POR_DEFECTO: Tema = 'noche';

export function esTema(valor: unknown): valor is Tema {
  return TEMAS.some((t) => t.id === valor);
}

export function leerTema(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    return esTema(guardado) ? guardado : TEMA_POR_DEFECTO;
  } catch {
    return TEMA_POR_DEFECTO;
  }
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset['tema'] = tema;
  const meta = document.querySelector('meta[name="theme-color"]');
  const color = TEMAS.find((t) => t.id === tema)?.themeColor;
  if (meta && color) meta.setAttribute('content', color);
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin almacenamiento (modo privado): el tema dura hasta recargar.
  }
}
