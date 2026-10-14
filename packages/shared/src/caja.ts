// Cálculos de la venta y del cierre de caja (sección 10 de docs/SPEC.md). Plata en centavos.

export function subtotal(cantidad: number, precioUnitario: number): number {
  return Math.round(cantidad * precioUnitario);
}

export function vuelto(total: number, recibido: number): number | null {
  return recibido >= total ? recibido - total : null;
}

/** Montos rápidos de "¿Con cuánto paga?": los billetes que alcanzan, sin repetir. */
export function montosRapidos(total: number): number[] {
  const billetes = [100000, 200000, 1000000, 2000000];
  return billetes.filter((b) => b >= total).slice(0, 4);
}

export interface Arqueo {
  cambioInicial: number;
  efectivoCobrado: number;
  gastosYRetiros: number;
}

/** cambio inicial + efectivo cobrado − gastos y retiros = debería haber. */
export function deberiaHaber(a: Arqueo): number {
  return a.cambioInicial + a.efectivoCobrado - a.gastosYRetiros;
}

/** "Faltan $ 500", "Sobran $ 200" o "Da justo". */
export function diferenciaEnPalabras(
  contado: number,
  esperado: number,
  formatear: (c: number) => string,
): string {
  const d = contado - esperado;
  if (d === 0) return 'Da justo';
  return d < 0 ? `Faltan ${formatear(-d)}` : `Sobran ${formatear(d)}`;
}
