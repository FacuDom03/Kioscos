// Escritor mínimo de planillas .xlsx: las planillas modelo que el comercio descarga, llena y
// vuelve a subir. Sin dependencias: un zip sin comprimir con el XML de cada hoja. Los textos van
// en la celda (inlineStr); los números, como número.

export type Celda = string | number | null;

export interface Hoja {
  nombre: string;
  filas: Celda[][];
  /** Ancho de cada columna, en caracteres. */
  anchos?: number[];
  /** Columnas con formato texto (códigos de barras: que Excel no los pase a 7,79E+12). */
  texto?: number[];
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of datos) c = (TABLA_CRC[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip sin comprimir (método 0): alcanza para unos pocos KB de XML. */
function armarZip(archivos: [string, string][]): Uint8Array {
  const cod = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let desplazamiento = 0;
  for (const [nombre, contenido] of archivos) {
    const n = cod.encode(nombre);
    const d = cod.encode(contenido);
    const crc = crc32(d);
    const local = new Uint8Array(30 + n.length + d.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true);
    vl.setUint16(4, 20, true);
    vl.setUint16(6, 0x0800, true); // nombres en UTF-8
    vl.setUint32(14, crc, true);
    vl.setUint32(18, d.length, true);
    vl.setUint32(22, d.length, true);
    vl.setUint16(26, n.length, true);
    local.set(n, 30);
    local.set(d, 30 + n.length);
    const central = new Uint8Array(46 + n.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, 20, true);
    vc.setUint16(6, 20, true);
    vc.setUint16(8, 0x0800, true);
    vc.setUint32(16, crc, true);
    vc.setUint32(20, d.length, true);
    vc.setUint32(24, d.length, true);
    vc.setUint16(28, n.length, true);
    vc.setUint32(42, desplazamiento, true);
    central.set(n, 46);
    locales.push(local);
    centrales.push(central);
    desplazamiento += local.length;
  }
  const tamCentral = centrales.reduce((t, c) => t + c.length, 0);
  const fin = new Uint8Array(22);
  const vf = new DataView(fin.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, archivos.length, true);
  vf.setUint16(10, archivos.length, true);
  vf.setUint32(12, tamCentral, true);
  vf.setUint32(16, desplazamiento, true);
  const salida = new Uint8Array(desplazamiento + tamCentral + 22);
  let p = 0;
  for (const parte of [...locales, ...centrales, fin]) {
    salida.set(parte, p);
    p += parte.length;
  }
  return salida;
}

const escapar = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de control que el XML no admite.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');

function letra(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Estilos: 0 normal, 1 encabezado en negrita, 2 texto.
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function xmlHoja(h: Hoja): string {
  const texto = new Set(h.texto ?? []);
  const columnas = Math.max(h.anchos?.length ?? 0, ...h.filas.map((f) => f.length));
  const cols = Array.from({ length: columnas }, (_, i) => {
    const ancho = h.anchos?.[i] ?? 12;
    const estilo = texto.has(i) ? ' style="2"' : '';
    return `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"${estilo}/>`;
  }).join('');
  const filas = h.filas
    .map((f, r) => {
      const celdas = f
        .map((v, c) => {
          if (v === null || v === '') return '';
          const ref = `${letra(c)}${r + 1}`;
          const s = r === 0 ? ' s="1"' : texto.has(c) ? ' s="2"' : '';
          if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapar(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${celdas}</row>`;
    })
    .join('');
  // La primera fila queda fija al bajar.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${filas}</sheetData></worksheet>`;
}

/** Arma un .xlsx con las hojas dadas. La primera es la que se lee al importar. */
export function escribirXlsx(hojas: Hoja[]): Uint8Array {
  const tipos = hojas
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  const libro = hojas
    .map(
      (h, i) =>
        `<sheet name="${escapar(h.nombre.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    )
    .join('');
  const relaciones = hojas
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join('');
  const n = hojas.length;
  return armarZip([
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tipos}</Types>`,
    ],
    [
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${libro}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relaciones}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', ESTILOS],
    ...hojas.map((h, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, xmlHoja(h)]),
  ]);
}
