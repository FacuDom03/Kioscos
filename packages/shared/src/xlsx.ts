// Lector mínimo de planillas .xlsx (etapa I3): primera hoja, solo valores, como texto. Sin
// dependencias: el .xlsx es un zip con XML adentro; se descomprime con DecompressionStream
// (navegador y Node 18+). Alcanza para las listas de precios que mandan los proveedores.
// No lee .xls viejos (formato binario): para esos, guardar como .xlsx o .csv.

const FIRMA_FIN = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_LOCAL = 0x04034b50;

export class ErrorPlanilla extends Error {}

interface Entrada {
  metodo: number;
  comprimido: number;
  desplazamiento: number;
}

function entradasZip(datos: Uint8Array): Map<string, Entrada> {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  let fin = -1;
  for (let i = datos.length - 22; i >= Math.max(0, datos.length - 66_000); i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ErrorPlanilla('El archivo no es una planilla .xlsx.');
  const total = vista.getUint16(fin + 10, true);
  let p = vista.getUint32(fin + 16, true);
  const entradas = new Map<string, Entrada>();
  const texto = new TextDecoder();
  for (let n = 0; n < total; n++) {
    if (vista.getUint32(p, true) !== FIRMA_CENTRAL)
      throw new ErrorPlanilla('La planilla está dañada.');
    const metodo = vista.getUint16(p + 10, true);
    const comprimido = vista.getUint32(p + 20, true);
    const largoNombre = vista.getUint16(p + 28, true);
    const largoExtra = vista.getUint16(p + 30, true);
    const largoComentario = vista.getUint16(p + 32, true);
    const desplazamiento = vista.getUint32(p + 42, true);
    const nombre = texto.decode(datos.subarray(p + 46, p + 46 + largoNombre));
    entradas.set(nombre, { metodo, comprimido, desplazamiento });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

async function leerArchivo(datos: Uint8Array, e: Entrada): Promise<string> {
  const vista = new DataView(datos.buffer, datos.byteOffset, datos.byteLength);
  if (vista.getUint32(e.desplazamiento, true) !== FIRMA_LOCAL)
    throw new ErrorPlanilla('La planilla está dañada.');
  const inicio =
    e.desplazamiento +
    30 +
    vista.getUint16(e.desplazamiento + 26, true) +
    vista.getUint16(e.desplazamiento + 28, true);
  const bytes = datos.subarray(inicio, inicio + e.comprimido);
  if (e.metodo === 0) return new TextDecoder().decode(bytes);
  if (e.metodo !== 8) throw new ErrorPlanilla('La planilla usa una compresión que no conocemos.');
  // Sin tipo explícito: en Node y en el navegador los tipos de los bytes difieren.
  const flujo = new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice());
      c.close();
    },
  }).pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(flujo).text();
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function desescapar(t: string): string {
  return t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    return ENTIDADES[e] ?? m;
  });
}

/** Texto de un nodo con uno o varios <t> (los "runs" con formato se unen). */
function textoDe(xml: string): string {
  let salida = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g))
    salida += desescapar(m[1] ?? '');
  return salida;
}

function columna(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Primera hoja de la planilla, fila por fila, cada celda como texto (vacías como ""). */
export async function leerXlsx(datos: Uint8Array, maxFilas = 50_000): Promise<string[][]> {
  const entradas = entradasZip(datos);
  const leer = async (nombre: string) => {
    const e = entradas.get(nombre);
    return e ? leerArchivo(datos, e) : null;
  };

  // La primera hoja según el libro (no siempre es sheet1.xml).
  let hoja = 'xl/worksheets/sheet1.xml';
  const libro = await leer('xl/workbook.xml');
  const relaciones = await leer('xl/_rels/workbook.xml.rels');
  const primera = libro && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(libro)?.[1];
  if (primera && relaciones) {
    for (const r of relaciones.matchAll(/<Relationship\b[^>]*>/g)) {
      if (r[0].includes(`Id="${primera}"`)) {
        const destino = /Target="([^"]+)"/.exec(r[0])?.[1];
        if (destino) hoja = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
      }
    }
  }
  const xml = await leer(hoja);
  if (!xml) throw new ErrorPlanilla('La planilla no tiene hojas.');

  const compartidas: string[] = [];
  const sst = await leer('xl/sharedStrings.xml');
  if (sst)
    for (const si of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textoDe(si[1] ?? ''));

  const filas: string[][] = [];
  // Primero las filas vacías (<row .../>), para no confundirlas con la apertura de una fila.
  for (const f of xml.matchAll(/<row\b[^>]*?\/>|<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    // Excel no guarda las filas vacías: se respetan los números de fila para que coincidan.
    const numero = Number(/\br="(\d+)"/.exec(f[0])?.[1] ?? filas.length + 1);
    while (filas.length < Math.min(numero - 1, maxFilas)) filas.push([]);
    if (filas.length >= maxFilas)
      throw new ErrorPlanilla(`La planilla tiene más de ${maxFilas} filas.`);
    const fila: string[] = [];
    for (const c of (f[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const atributos = c[1] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1];
      const tipo = /\bt="(\w+)"/.exec(atributos)?.[1];
      const cuerpo = c[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(cuerpo)?.[1];
      let valor = '';
      if (tipo === 's') valor = compartidas[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else if (v !== undefined) valor = desescapar(v);
      const i = ref ? columna(ref) : fila.length;
      while (fila.length < i) fila.push('');
      fila[i] = valor.trim();
    }
    filas.push(fila);
  }
  return filas;
}
