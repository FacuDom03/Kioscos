export { moverStock, type TipoMovimiento } from '@mostrador/db';

/** Detecta el tipo de código de barras por su forma. */
export function tipoDeCodigo(
  codigo: string,
): 'ean13' | 'ean8' | 'upca' | 'upce' | 'code128' | 'interno' {
  if (/^\d{13}$/.test(codigo)) return 'ean13';
  if (/^\d{12}$/.test(codigo)) return 'upca';
  if (/^\d{8}$/.test(codigo)) return 'ean8';
  if (/^\d{6}$/.test(codigo)) return 'upce';
  if (/^[\x20-\x7e]{1,48}$/.test(codigo) && !/^\d{1,5}$/.test(codigo)) return 'code128';
  return 'interno';
}
