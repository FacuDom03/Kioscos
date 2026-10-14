// Búsqueda de productos en el equipo (tiene que tardar menos de 100 ms con miles de productos).

export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, ' ')
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
    items: items.map((item) => ({ item, texto: ` ${normalizar(item.nombre)}` })),
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
