// Promos automáticas (etapa I7, docs/decisiones/009-rubros.md): 3x2, segunda unidad con
// descuento y parecidas. La misma cuenta corre en el equipo (para armar el ticket, también sin
// conexión) y en el servidor (para validar lo que se descontó).

export interface Promo {
  id: string;
  nombre: string;
  /** Cada `lleva` unidades, las `paga` más caras van a precio lleno… */
  lleva: number;
  paga: number;
  /** …y el resto con este por ciento menos (100: gratis). */
  descuento: number;
  categoriaId: string | null;
  grupoId: string | null;
  /** AAAA-MM-DD, en la Argentina. */
  desde: string | null;
  hasta: string | null;
}

export interface ItemPromo {
  productoId: string | null;
  cantidad: number;
  precioUnitario: number;
  categoriaId: string | null;
  grupoId: string | null;
}

export interface Descuento {
  promoId: string;
  descripcion: string;
  monto: number;
  /** Unidades que salieron con descuento. */
  unidades: number;
}

const ORDINAL = ['', '1ra', '2da', '3ra', '4ta', '5ta', '6ta', '7ma', '8va', '9na', '10ma'];

/** La regla en pocas palabras: "3x2", "2da con 50% menos", "Llevando 4, 2 con 30% menos". */
export function reglaPromo(p: Pick<Promo, 'lleva' | 'paga' | 'descuento'>): string {
  if (p.descuento === 100) return `${p.lleva}x${p.paga}`;
  if (p.paga === p.lleva - 1 && ORDINAL[p.lleva])
    return `${ORDINAL[p.lleva]} con ${p.descuento}% menos`;
  return `Llevando ${p.lleva}, ${p.lleva - p.paga} con ${p.descuento}% menos`;
}

/** Si la promo corre ese día (AAAA-MM-DD). */
export function promoVigente(p: Pick<Promo, 'desde' | 'hasta'>, dia: string): boolean {
  return (!p.desde || p.desde <= dia) && (!p.hasta || dia <= p.hasta);
}

/** La promo que le toca a un ítem: la del producto con variantes gana sobre la de su categoría. */
function promoDe(item: ItemPromo, promos: readonly Promo[]): Promo | undefined {
  if (!item.productoId || !Number.isInteger(item.cantidad) || item.cantidad <= 0) return undefined;
  return (
    (item.grupoId ? promos.find((p) => p.grupoId === item.grupoId) : undefined) ??
    (item.categoriaId ? promos.find((p) => p.categoriaId === item.categoriaId) : undefined)
  );
}

/**
 * Descuentos de las promos que corren `dia` sobre los ítems del ticket. Las unidades se ordenan de
 * la más cara a la más barata y se agrupan de a `lleva`: en cada grupo completo, las últimas
 * (las más baratas) llevan el descuento. Solo cuentan cantidades enteras (no se fracciona un 3x2).
 */
export function calcularPromos(
  items: readonly ItemPromo[],
  promos: readonly Promo[],
  dia: string,
): Descuento[] {
  const corren = promos
    .filter((p) => promoVigente(p, dia) && p.lleva > p.paga && p.descuento > 0)
    .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  const porPromo = new Map<Promo, { precio: number; cantidad: number }[]>();
  for (const item of items) {
    const promo = promoDe(item, corren);
    if (!promo) continue;
    const tramos = porPromo.get(promo) ?? [];
    tramos.push({ precio: item.precioUnitario, cantidad: item.cantidad });
    porPromo.set(promo, tramos);
  }

  const descuentos: Descuento[] = [];
  for (const promo of corren) {
    const tramos = porPromo.get(promo);
    if (!tramos) continue;
    tramos.sort((a, b) => b.precio - a.precio);
    const total = tramos.reduce((t, x) => t + x.cantidad, 0);
    const completos = Math.floor(total / promo.lleva) * promo.lleva;
    // Cuántas posiciones antes de `x` llevan descuento.
    const conDescuento = (x: number) => {
      const hasta = Math.min(x, completos);
      return (
        Math.floor(hasta / promo.lleva) * (promo.lleva - promo.paga) +
        Math.max(0, (hasta % promo.lleva) - promo.paga)
      );
    };
    let posicion = 0;
    let monto = 0;
    let unidades = 0;
    for (const t of tramos) {
      const n = conDescuento(posicion + t.cantidad) - conDescuento(posicion);
      monto += n * Math.round((t.precio * promo.descuento) / 100);
      unidades += n;
      posicion += t.cantidad;
    }
    if (monto > 0)
      descuentos.push({ promoId: promo.id, descripcion: promo.nombre, monto, unidades });
  }
  return descuentos;
}

/**
 * Lo que vale lo que se devuelve en un cambio: lo que se pagó por esas unidades, con su parte de
 * las promos de aquella venta.
 */
export function importeDevuelto(
  item: { cantidad: number; subtotal: number },
  cantidad: number,
  venta: { suma: number; descuentos: number },
): number {
  const bruto = (item.subtotal * cantidad) / item.cantidad;
  const factor = venta.suma > 0 ? (venta.suma - venta.descuentos) / venta.suma : 1;
  return Math.round(bruto * factor);
}

/**
 * Lo que vale devolver `cantidad` cuando ya se devolvieron `yaDevuelto` unidades del mismo
 * renglón: la diferencia entre lo devuelto en total y lo de antes. Así, devolviendo de a una, la
 * suma nunca pasa de lo que se pagó.
 */
export function importeDeDevolucion(
  item: { cantidad: number; subtotal: number },
  yaDevuelto: number,
  cantidad: number,
  venta: { suma: number; descuentos: number },
): number {
  return (
    importeDevuelto(item, yaDevuelto + cantidad, venta) - importeDevuelto(item, yaDevuelto, venta)
  );
}
