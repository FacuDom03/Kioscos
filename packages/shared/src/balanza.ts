// Códigos de balanza: EAN-13 que empiezan con 20 a 29 (sección 10). Formato configurable:
// prefijo de 2 dígitos + código de producto de 5 + valor de 5 + dígito verificador.

export interface FormatoBalanza {
  /** Qué representa el valor: el precio total en pesos o el peso en gramos. */
  valor: 'precio' | 'peso';
  /** Decimales del valor cuando es precio (0: pesos enteros; 2: centavos). */
  decimalesPrecio: 0 | 1 | 2;
}

export const FORMATO_BALANZA_DEFECTO: FormatoBalanza = { valor: 'precio', decimalesPrecio: 0 };

export function digitoVerificadorEan13(doce: string): number {
  let suma = 0;
  for (let i = 0; i < 12; i++) suma += Number(doce[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (suma % 10)) % 10;
}

export function esEan13Valido(codigo: string): boolean {
  return (
    /^\d{13}$/.test(codigo) && digitoVerificadorEan13(codigo.slice(0, 12)) === Number(codigo[12])
  );
}

export interface LecturaBalanza {
  codigoProducto: string;
  /** Precio total en centavos (si el formato es de precio). */
  precio?: number;
  /** Peso en kilos (si el formato es de peso). */
  kilos?: number;
}

export function leerCodigoBalanza(
  codigo: string,
  formato: FormatoBalanza = FORMATO_BALANZA_DEFECTO,
): LecturaBalanza | null {
  if (!/^2\d{12}$/.test(codigo) || !esEan13Valido(codigo)) return null;
  const codigoProducto = codigo.slice(2, 7);
  const valor = Number(codigo.slice(7, 12));
  if (formato.valor === 'peso') return { codigoProducto, kilos: valor / 1000 };
  const centavos =
    formato.decimalesPrecio === 2
      ? valor
      : formato.decimalesPrecio === 1
        ? valor * 10
        : valor * 100;
  return { codigoProducto, precio: centavos };
}
