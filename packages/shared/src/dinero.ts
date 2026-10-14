// La plata se maneja siempre en centavos enteros. Nunca float.
// En JS se usa `number` (entero seguro hasta 2^53, más que suficiente para un kiosco);
// ver docs/decisiones/003-plata-en-centavos.md.

function verificarCentavos(centavos: number): void {
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError(`Monto inválido en centavos: ${centavos}`);
  }
}

const formatoEntero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const formatoDecimal = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `150000` → `"$ 1.500"`; `150050` → `"$ 1.500,50"`; `-50000` → `"-$ 500"`. */
export function formatearPlata(centavos: number): string {
  verificarCentavos(centavos);
  const abs = Math.abs(centavos);
  const pesos =
    abs % 100 === 0 ? formatoEntero.format(abs / 100) : formatoDecimal.format(abs / 100);
  return `${centavos < 0 ? '-' : ''}$ ${pesos}`;
}

/** Convierte pesos enteros (por ejemplo, un botón de "$ 1.000") a centavos. */
export function centavosDesdePesos(pesos: number): number {
  if (!Number.isSafeInteger(pesos)) {
    throw new RangeError(`Monto inválido en pesos: ${pesos}`);
  }
  const centavos = pesos * 100;
  verificarCentavos(centavos);
  return centavos;
}
