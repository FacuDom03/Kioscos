// Planilla modelo para importar productos: el comercio la descarga, la llena en Excel y la sube.
// Las columnas son las que lee POST /api/v1/productos/importar (el encabezado se compara sin
// mayúsculas ni tildes).
import type { Rubro } from './rubros.ts';
import type { Celda, Hoja } from './xlsx-escribir.ts';

export interface OpcionesPlanilla {
  rubro: Rubro;
  /** Venta por metro, kilo, litro o caja. */
  unidades: boolean;
  ubicaciones: boolean;
  gremio: boolean;
}

interface Columna {
  titulo: string;
  ancho: number;
  ayuda: string;
  /** Formato texto en Excel. */
  texto?: boolean;
  /** Nombre de la columna para cada uno de los ejemplos (mismo orden que EJEMPLOS). */
  clave: keyof Ejemplo;
}

interface Ejemplo {
  nombre: string;
  precio: number;
  codigo: string;
  categoria: string;
  costo: number;
  stock: number;
  minimo: number;
  unidad: string;
  ubicacion: string;
  gremio: number | null;
}

const EJEMPLOS: Record<Rubro, Ejemplo[]> = {
  kiosco: [
    ej('Alfajor triple chocolate', 1500, '7790580123459', 'Golosinas', 950, 24, 6),
    ej('Gaseosa cola 500 ml', 1800, '7790895000997', 'Bebidas', 1150, 12, 6),
    ej('Encendedor', 900, '', 'Varios', 500, 10, 3),
  ],
  almacen: [
    ej('Yerba mate 1 kg', 4200, '7790387000125', 'Almacén', 3100, 10, 4),
    ej('Queso cremoso', 9800, '', 'Fiambrería', 7000, 5, 2, 'kilo'),
    ej('Leche entera 1 l', 1300, '7790742000014', 'Lácteos', 950, 12, 6),
  ],
  ferreteria: [
    ej(
      'Cable unipolar 2,5 mm rojo',
      1450,
      '',
      'Electricidad',
      980,
      200,
      50,
      'metro',
      'Pasillo 2',
      1300,
    ),
    ej(
      'Tarugo 8 mm x 100',
      5200,
      '7798012345671',
      'Fijaciones',
      3400,
      3,
      10,
      'caja',
      'Estante B',
      4700,
    ),
    ej(
      'Martillo carpintero',
      18500,
      '7798012345688',
      'Herramientas',
      12000,
      4,
      2,
      'unidad',
      'Mostrador',
      null,
    ),
  ],
  perfumeria: [
    ej('Esmalte rojo pasión', 3200, '7791234500011', 'Maquillaje', 1900, 6, 2),
    ej('Shampoo 400 ml', 5400, '7791234500028', 'Pelo', 3600, 8, 3),
    ej('Perfume 100 ml', 42000, '7791234500035', 'Perfumes', 28000, 2, 1),
  ],
  libreria: [
    ej('Cuaderno tapa dura 48 hojas', 3500, '7792345600016', 'Cuadernos', 2200, 20, 5),
    ej('Birome azul', 600, '7792345600023', 'Escritura', 350, 50, 10),
    ej('Resma A4 500 hojas', 9800, '7792345600030', 'Papel', 7200, 6, 2),
  ],
  otro: [
    ej('Producto de ejemplo', 2500, '7790000000017', 'General', 1600, 10, 2),
    ej('Otro producto', 1200, '', 'General', 700, 5, 1),
  ],
};

function ej(
  nombre: string,
  precio: number,
  codigo: string,
  categoria: string,
  costo: number,
  stock: number,
  minimo: number,
  unidad = 'unidad',
  ubicacion = '',
  gremio: number | null = null,
): Ejemplo {
  return { nombre, precio, codigo, categoria, costo, stock, minimo, unidad, ubicacion, gremio };
}

function columnas(o: OpcionesPlanilla): Columna[] {
  return [
    {
      clave: 'nombre',
      titulo: 'Nombre',
      ancho: 34,
      ayuda: 'Obligatoria. Como lo buscás al vender.',
    },
    {
      clave: 'precio',
      titulo: 'Precio',
      ancho: 12,
      ayuda: 'Obligatoria. Precio de venta en pesos, sin el signo $ (por ejemplo 1500 o 1500,50).',
    },
    {
      clave: 'codigo',
      titulo: 'Código',
      ancho: 18,
      texto: true,
      ayuda:
        'Código de barras. Si ya existe un producto con ese código, se actualiza en vez de crear otro.',
    },
    {
      clave: 'categoria',
      titulo: 'Categoría',
      ancho: 18,
      ayuda: 'Si no existe, se crea.',
    },
    { clave: 'costo', titulo: 'Costo', ancho: 12, ayuda: 'Lo que te cuesta a vos, en pesos.' },
    {
      clave: 'stock',
      titulo: 'Stock',
      ancho: 10,
      ayuda: 'Cuántos tenés hoy. Se carga solo en los productos nuevos.',
    },
    {
      clave: 'minimo',
      titulo: 'Mínimo',
      ancho: 10,
      ayuda: 'Con menos que esto, el producto aparece en "Por reponer".',
    },
    ...(o.unidades
      ? [
          {
            clave: 'unidad' as const,
            titulo: 'Unidad',
            ancho: 10,
            ayuda: 'unidad, metro, kilo, litro o caja. Vacía es unidad.',
          },
        ]
      : []),
    ...(o.ubicaciones
      ? [
          {
            clave: 'ubicacion' as const,
            titulo: 'Ubicación',
            ancho: 14,
            ayuda: 'Dónde está en el local (pasillo, estante, cajón).',
          },
        ]
      : []),
    ...(o.gremio
      ? [
          {
            clave: 'gremio' as const,
            titulo: 'Precio gremio',
            ancho: 14,
            ayuda: 'Precio para clientes del gremio, en pesos.',
          },
        ]
      : []),
  ];
}

/** La planilla modelo: hoja "Productos" con ejemplos y hoja "Cómo llenarla". */
export function planillaModelo(o: OpcionesPlanilla): Hoja[] {
  const cols = columnas(o);
  const filas: Celda[][] = [
    cols.map((c) => c.titulo),
    ...EJEMPLOS[o.rubro].map((e) => cols.map((c) => e[c.clave])),
  ];
  return [
    {
      nombre: 'Productos',
      filas,
      anchos: cols.map((c) => c.ancho),
      texto: cols.flatMap((c, i) => (c.texto ? [i] : [])),
    },
    {
      nombre: 'Cómo llenarla',
      anchos: [16, 90],
      filas: [
        ['Columna', 'Qué va'],
        ...cols.map((c) => [c.titulo, c.ayuda]),
        [],
        ['Antes de subirla', 'Borrá las filas de ejemplo y dejá la primera fila como está.'],
        [
          'Para subirla',
          'En Mostrador: Stock → Importar productos desde un archivo → Elegir archivo.',
        ],
        ['Máximo', '5000 productos por archivo.'],
      ],
    },
  ];
}

const NUMERO_EXCEL = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i;
const COLUMNAS_PLATA = new Set(['precio', 'costo', 'gremio', 'precio gremio']);

const normalizarTitulo = (t: string) => t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Las celdas numéricas de un .xlsx llegan como en inglés ("1500.5", "7.79E+12"). Se pasan a como
 * se escriben acá ("1500,5", "7790000000000") para que la importación las lea igual que un CSV.
 */
export function filasDeXlsxParaImportar(filas: string[][]): string[][] {
  const encabezado = (filas[0] ?? []).map(normalizarTitulo);
  return filas.map((f, r) =>
    r === 0
      ? f
      : f.map((v, c) => {
          if (!NUMERO_EXCEL.test(v)) return v;
          const n = Number(v);
          if (!Number.isFinite(n)) return v;
          const titulo = encabezado[c] ?? '';
          if (titulo === 'codigo') return Number.isSafeInteger(n) ? String(n) : v;
          const decimales = COLUMNAS_PLATA.has(titulo) ? 2 : 3;
          const redondeado = Math.round(n * 10 ** decimales) / 10 ** decimales;
          return String(redondeado).replace('.', ',');
        }),
  );
}
