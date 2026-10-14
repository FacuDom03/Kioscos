import { readFileSync } from 'node:fs';

/**
 * Claves maestras de cifrado. Archivo JSON fuera del repo y de la base:
 *   { "actual": 1, "claves": { "1": "<32 bytes en base64>" } }
 * Para rotar: agregar la versión 2, cambiar "actual" y volver a cifrar con el script.
 */
export function leerClaves(): { claves: Record<number, string>; actual: number } {
  const archivo = process.env['MOSTRADOR_CLAVES_ARCHIVO'];
  const crudo = archivo ? readFileSync(archivo, 'utf8') : process.env['MOSTRADOR_CLAVES'];
  if (!crudo) throw new Error('Faltan las claves de cifrado (MOSTRADOR_CLAVES_ARCHIVO)');
  const datos = JSON.parse(crudo) as { actual: number; claves: Record<string, string> };
  const claves: Record<number, string> = {};
  for (const [v, k] of Object.entries(datos.claves)) claves[Number(v)] = k;
  if (!claves[datos.actual]) throw new Error('La clave actual no está en el archivo de claves');
  return { claves, actual: datos.actual };
}
