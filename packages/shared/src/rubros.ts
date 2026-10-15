// Rubros del comercio y funciones que se pueden activar (docs/decisiones/009-rubros.md).
// Un mismo sistema sirve a varios rubros: cada uno arranca con su diseño, sus categorías y sus
// funciones, y el dueño puede cambiarlos después.

export const RUBROS = [
  'kiosco',
  'almacen',
  'ferreteria',
  'perfumeria',
  'libreria',
  'otro',
] as const;
export type Rubro = (typeof RUBROS)[number];

/** Funciones que dependen del rubro. Mantener en sincronía con el check de kioscos.modulos. */
export const MODULOS = [
  'venta_fraccionada',
  'presupuestos',
  'listas_precios',
  'ubicaciones',
  'precios_proveedor',
  'cuenta_corriente',
  'variantes',
  'promos',
  'regalo',
  'vencimientos',
] as const;
export type Modulo = (typeof MODULOS)[number];

/**
 * `kiosco`: toldo, cartel estrella y letra de marcador. `sobrio`: sin adornos, más información
 * por pantalla, pensado para la PC del mostrador.
 */
export type Estilo = 'kiosco' | 'sobrio';

export type TemaRubro = 'noche' | 'dia' | 'pizarron' | 'sobrio' | 'grafito' | 'boutique';

export interface DatosModulo {
  id: Modulo;
  nombre: string;
  descripcion: string;
  /** false mientras la función se está construyendo: se puede dejar elegida, pero avisa. */
  disponible: boolean;
}

export const DATOS_MODULOS: Record<Modulo, DatosModulo> = {
  venta_fraccionada: {
    id: 'venta_fraccionada',
    nombre: 'Venta por metro, kilo o caja',
    descripcion: 'Cantidades con decimales: cable, cadena, fiambre, clavos sueltos.',
    disponible: true,
  },
  presupuestos: {
    id: 'presupuestos',
    nombre: 'Presupuestos y remitos',
    descripcion: 'Se mandan por WhatsApp y pasan a venta con un toque.',
    disponible: true,
  },
  listas_precios: {
    id: 'listas_precios',
    nombre: 'Dos listas: mostrador y gremio',
    descripcion: 'Precio aparte para plomeros, electricistas y clientes de siempre.',
    disponible: true,
  },
  ubicaciones: {
    id: 'ubicaciones',
    nombre: 'Dónde está cada cosa',
    descripcion: 'Pasillo y estante en cada producto.',
    disponible: true,
  },
  precios_proveedor: {
    id: 'precios_proveedor',
    nombre: 'Actualizar precios con la lista del proveedor',
    descripcion: 'Subís su lista y se recalculan los precios.',
    disponible: true,
  },
  cuenta_corriente: {
    id: 'cuenta_corriente',
    nombre: 'Cuenta corriente',
    descripcion: 'Clientes que pagan después, con límite.',
    disponible: true,
  },
  variantes: {
    id: 'variantes',
    nombre: 'Tonos y tamaños',
    descripcion: 'Un producto con varias opciones, cada una con su stock.',
    disponible: true,
  },
  promos: {
    id: 'promos',
    nombre: 'Promos automáticas',
    descripcion: '3x2, segunda unidad con descuento y otras.',
    disponible: true,
  },
  regalo: {
    id: 'regalo',
    nombre: 'Regalos y cambios',
    descripcion: 'Envolver para regalo y ticket de cambio sin precios.',
    disponible: true,
  },
  vencimientos: {
    id: 'vencimientos',
    nombre: 'Vencimientos',
    descripcion: 'Aviso de lo que vence pronto.',
    disponible: true,
  },
};

export interface DatosRubro {
  id: Rubro;
  nombre: string;
  /** Para "Tu ferretería, lista para usar" / "Tu kiosco, listo para usar". */
  femenino: boolean;
  descripcion: string;
  estilo: Estilo;
  tema: TemaRubro;
  /** Categorías sugeridas al armar el negocio. Las marcadas con `activa` vienen tildadas. */
  categorias: readonly { nombre: string; activa: boolean }[];
  /** Funciones que vienen activadas. */
  modulos: readonly Modulo[];
  /** Funciones que se ofrecen (activadas o no) al armar el negocio, en orden. */
  ofrecidos: readonly Modulo[];
  /** Nombre propio de alguna función en este rubro ("Fiado" en el almacén). */
  nombres?: Partial<Record<Modulo, string>>;
}

const cat = (activas: string[], otras: string[] = []) => [
  ...activas.map((nombre) => ({ nombre, activa: true })),
  ...otras.map((nombre) => ({ nombre, activa: false })),
];

export const DATOS_RUBROS: Record<Rubro, DatosRubro> = {
  kiosco: {
    id: 'kiosco',
    nombre: 'Kiosco',
    femenino: false,
    descripcion: 'Golosinas, bebidas, cigarrillos',
    estilo: 'kiosco',
    tema: 'noche',
    categorias: cat(['Golosinas', 'Bebidas', 'Cigarrillos', 'Galletitas'], ['Lácteos', 'Varios']),
    modulos: [],
    ofrecidos: ['cuenta_corriente', 'vencimientos'],
  },
  almacen: {
    id: 'almacen',
    nombre: 'Almacén',
    femenino: false,
    descripcion: 'Balanza y fiado',
    estilo: 'kiosco',
    tema: 'pizarron',
    categorias: cat(
      ['Almacén', 'Fiambrería', 'Lácteos', 'Bebidas', 'Limpieza'],
      ['Panadería', 'Verdulería'],
    ),
    modulos: ['venta_fraccionada', 'cuenta_corriente'],
    ofrecidos: ['venta_fraccionada', 'cuenta_corriente', 'vencimientos', 'listas_precios'],
    nombres: { cuenta_corriente: 'Fiado' },
  },
  ferreteria: {
    id: 'ferreteria',
    nombre: 'Ferretería',
    femenino: true,
    descripcion: 'Metro, kilo y presupuestos',
    estilo: 'sobrio',
    tema: 'sobrio',
    categorias: cat(
      ['Electricidad', 'Plomería', 'Pinturería', 'Bulonería', 'Herramientas', 'Construcción'],
      ['Jardín', 'Sanitarios'],
    ),
    modulos: [
      'precios_proveedor',
      'venta_fraccionada',
      'presupuestos',
      'listas_precios',
      'ubicaciones',
    ],
    ofrecidos: [
      'precios_proveedor',
      'venta_fraccionada',
      'presupuestos',
      'listas_precios',
      'ubicaciones',
      'cuenta_corriente',
    ],
  },
  perfumeria: {
    id: 'perfumeria',
    nombre: 'Perfumería',
    femenino: true,
    descripcion: 'Tonos, promos y regalos',
    estilo: 'sobrio',
    tema: 'boutique',
    categorias: cat(
      ['Fragancias', 'Maquillaje', 'Cuidado de la piel', 'Cabello', 'Higiene'],
      ['Regalería', 'Accesorios'],
    ),
    modulos: ['variantes', 'promos', 'regalo', 'vencimientos'],
    ofrecidos: ['variantes', 'promos', 'regalo', 'vencimientos', 'cuenta_corriente'],
  },
  libreria: {
    id: 'libreria',
    nombre: 'Librería',
    femenino: true,
    descripcion: 'Útiles y fotocopias',
    estilo: 'kiosco',
    tema: 'dia',
    categorias: cat(
      ['Útiles escolares', 'Papelería', 'Fotocopias', 'Regalería'],
      ['Juguetería', 'Mochilas'],
    ),
    modulos: [],
    ofrecidos: ['presupuestos', 'cuenta_corriente', 'variantes'],
  },
  otro: {
    id: 'otro',
    nombre: 'Otro rubro',
    femenino: false,
    descripcion: 'Te armamos lo básico',
    estilo: 'sobrio',
    tema: 'sobrio',
    categorias: [],
    modulos: [],
    ofrecidos: [...MODULOS],
  },
};

export function esRubro(valor: unknown): valor is Rubro {
  return RUBROS.includes(valor as Rubro);
}

/** Nombre de una función en el rubro ("Fiado" en el almacén, "Cuenta corriente" en el resto). */
export function nombreModulo(rubro: Rubro, modulo: Modulo): string {
  return DATOS_RUBROS[rubro].nombres?.[modulo] ?? DATOS_MODULOS[modulo].nombre;
}

/** "Tu ferretería, lista para usar" / "Tu negocio, listo para usar". */
export function tituloListo(rubro: Rubro): string {
  if (rubro === 'otro') return 'Tu negocio, listo para usar';
  const r = DATOS_RUBROS[rubro];
  return `Tu ${r.nombre.toLowerCase()}, ${r.femenino ? 'lista' : 'listo'} para usar`;
}
