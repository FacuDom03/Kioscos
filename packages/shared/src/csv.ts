// Lector de CSV mínimo: comillas dobles, separador "," o ";" (Excel en castellano usa ";").

export function leerCsv(texto: string): string[][] {
  const limpio = texto.replace(/^\uFEFF/, '');
  const primera = limpio.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ';' : ',';
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio.charAt(i);
    if (comillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(campo);
      if (fila.some((x) => x.trim() !== '')) filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  fila.push(campo);
  if (fila.some((x) => x.trim() !== '')) filas.push(fila);
  return filas;
}

/** Escapa un valor para CSV (separador ";", que abre bien en Excel en castellano). */
export function celdaCsv(valor: string | number | null | undefined): string {
  const s = valor == null ? '' : String(valor);
  // Evita inyección de fórmulas al abrir en Excel.
  const seguro = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function armarCsv(filas: (string | number | null | undefined)[][]): string {
  return '﻿' + filas.map((f) => f.map(celdaCsv).join(';')).join('\r\n') + '\r\n';
}
