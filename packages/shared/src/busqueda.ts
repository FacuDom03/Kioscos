// Búsqueda de productos en el equipo (tiene que tardar menos de 100 ms con miles de productos).

const FRACCION: Record<string, string> = { '½': '1/2', '¼': '1/4', '¾': '3/4' };
const DECIMALES: Record<string, string> = { '½': '5', '¼': '25', '¾': '75' };

/**
 * Texto para comparar: sin tildes ni mayúsculas, y con las medidas escritas de una sola forma
 * ("2,5", "2.5" y "2½" quedan "2.5"; "½" queda "1/2"; "2.5mm" queda "2.5 mm").
 */
export function normalizar(texto: string): string {
  return texto
    .replace(/(\d) ?([½¼¾])/g, (_, n: string, f: string) => `${n}.${DECIMALES[f]}`)
    .replace(/[½¼¾]/g, (f) => FRACCION[f] ?? ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d)[.,](?=\d)/g, '$1\uE000')
    .replace(/(\d)\/(?=\d)/g, '$1\uE001')
    .replace(/[^a-z0-9ñ\uE000\uE001 ]/g, ' ')
    .replace(/\uE000/g, '.')
    .replace(/\uE001/g, '/')
    .replace(/(\d)(?=[a-zñ])/g, '$1 ')
    .replace(/([a-zñ])(?=\d)/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Buscable {
  id: string;
  nombre: string;
  codigos: string[];
}

export interface Indice<T extends Buscable> {
  porCodigo: Map<string, T>;
  items: { item: T; texto: string }[];
}

export function indexar<T extends Buscable>(items: T[]): Indice<T> {
  const porCodigo = new Map<string, T>();
  for (const it of items) for (const c of it.codigos) porCodigo.set(c, it);
  return {
    porCodigo,
    // Los códigos propios (con letras, como "ELE-0125") también se buscan por partes.
    items: items.map((item) => ({
      item,
      texto: ` ${normalizar([item.nombre, ...item.codigos.filter((c) => /[a-z]/i.test(c))].join(' '))}`,
    })),
  };
}

/**
 * Si la consulta es un código exacto, devuelve ese producto. Si no, los productos cuyo nombre
 * contiene todas las palabras; primero los que empiezan con la primera palabra.
 */
export function buscar<T extends Buscable>(indice: Indice<T>, consulta: string, limite = 30): T[] {
  const q = consulta.trim();
  if (!q) return [];
  const exacto = indice.porCodigo.get(q);
  if (exacto) return [exacto];
  const palabras = normalizar(q).split(' ').filter(Boolean);
  if (!palabras.length) return [];
  const empiezan: T[] = [];
  const contienen: T[] = [];
  for (const { item, texto } of indice.items) {
    if (!palabras.every((p) => texto.includes(p))) continue;
    (texto.startsWith(` ${palabras[0]}`) ? empiezan : contienen).push(item);
    if (empiezan.length >= limite) break;
  }
  return [...empiezan, ...contienen].slice(0, limite);
}
