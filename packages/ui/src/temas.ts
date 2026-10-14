// Temas y estilos. El tema es por equipo: se guarda en localStorage y se aplica con `data-tema`
// en <html>. El estilo sale del rubro del comercio (`data-estilo`): `kiosco` lleva toldo, cartel
// estrella y letra de marcador; `sobrio` no tiene adornos. El script public/tema.js de la app
// aplica los dos antes de pintar.

export type Estilo = 'kiosco' | 'sobrio';

export const TEMAS = [
  {
    id: 'noche',
    nombre: 'Noche',
    descripcion: 'Oscuro. Cansa menos la vista con poca luz.',
    themeColor: '#111936',
    estilos: ['kiosco'],
  },
  {
    id: 'dia',
    nombre: 'Día',
    descripcion: 'Claro. Se lee mejor con sol o mucha luz.',
    themeColor: '#EEF1F5',
    estilos: ['kiosco'],
  },
  {
    id: 'pizarron',
    nombre: 'Pizarrón',
    descripcion: 'Verde oscuro, como la pizarra de precios.',
    themeColor: '#15302A',
    estilos: ['kiosco'],
  },
  {
    id: 'sobrio',
    nombre: 'Claro',
    descripcion: 'Blanco y gris, sin adornos. Ideal para la PC del mostrador.',
    themeColor: '#F2F3F5',
    estilos: ['sobrio'],
  },
  {
    id: 'grafito',
    nombre: 'Grafito',
    descripcion: 'Oscuro y sobrio. Cansa menos la vista con poca luz.',
    themeColor: '#16191D',
    estilos: ['sobrio'],
  },
  {
    id: 'boutique',
    nombre: 'Boutique',
    descripcion: 'Claro, con detalles en color ciruela.',
    themeColor: '#FAF8F9',
    estilos: ['sobrio'],
  },
  {
    id: 'contraste',
    nombre: 'Alto contraste',
    descripcion: 'Blanco sobre negro, para leer sin esfuerzo.',
    themeColor: '#000000',
    estilos: ['kiosco', 'sobrio'],
  },
] as const satisfies readonly {
  id: string;
  nombre: string;
  descripcion: string;
  themeColor: string;
  estilos: readonly Estilo[];
}[];

export type Tema = (typeof TEMAS)[number]['id'];

export const CLAVE_TEMA = 'mostrador.tema';
export const CLAVE_ESTILO = 'mostrador.estilo';
export const TEMA_POR_DEFECTO: Tema = 'noche';

export function esTema(valor: unknown): valor is Tema {
  return TEMAS.some((t) => t.id === valor);
}

export function esEstilo(valor: unknown): valor is Estilo {
  return valor === 'kiosco' || valor === 'sobrio';
}

/** Temas que se ofrecen en un estilo, en el orden de la lista. */
export function temasDeEstilo(estilo: Estilo) {
  return TEMAS.filter((t) => (t.estilos as readonly Estilo[]).includes(estilo));
}

/** Tema elegido en este equipo, o null si nunca se eligió. */
export function temaGuardado(): Tema | null {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    return esTema(guardado) ? guardado : null;
  } catch {
    return null;
  }
}

export function leerTema(): Tema {
  return temaGuardado() ?? TEMA_POR_DEFECTO;
}

export function leerEstilo(): Estilo {
  try {
    const guardado = localStorage.getItem(CLAVE_ESTILO);
    return esEstilo(guardado) ? guardado : 'kiosco';
  } catch {
    return 'kiosco';
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

/**
 * Aplica el estilo del rubro y, si el tema del equipo no es de ese estilo (o nunca se eligió
 * uno), el tema del rubro.
 */
export function aplicarEstilo(estilo: Estilo, temaDelRubro: Tema): void {
  document.documentElement.dataset['estilo'] = estilo;
  try {
    localStorage.setItem(CLAVE_ESTILO, estilo);
  } catch {
    // Sin almacenamiento: el estilo dura hasta recargar.
  }
  const actual = temaGuardado();
  const sirve = actual && temasDeEstilo(estilo).some((t) => t.id === actual);
  aplicarTema(sirve ? actual : temaDelRubro);
}
