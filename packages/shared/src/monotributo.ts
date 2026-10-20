// Topes del monotributo (docs/CONTABILIDAD.md): cuánto puede facturar por año cada categoría.
// ARCA los actualiza dos veces por año (febrero y agosto): se agrega una entrada con su fecha de
// vigencia y queda la historia. Fuente: https://www.afip.gob.ar/monotributo/categorias.asp

export const CATEGORIAS_MONOTRIBUTO = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'I',
  'J',
  'K',
] as const;
export type CategoriaMonotributo = (typeof CATEGORIAS_MONOTRIBUTO)[number];

/** Ingresos brutos anuales máximos, en centavos, desde cada fecha. */
export const TOPES_MONOTRIBUTO: readonly {
  desde: string;
  topes: Record<CategoriaMonotributo, number>;
}[] = [
  {
    desde: '2026-08-01',
    topes: {
      A: 1_200_941_000,
      B: 1_759_518_300,
      C: 2_467_049_400,
      D: 3_062_865_100,
      E: 3_602_823_100,
      F: 4_515_165_900,
      G: 5_399_579_900,
      H: 8_192_466_000,
      I: 9_169_976_200,
      J: 10_501_251_900,
      K: 12_661_083_900,
    },
  },
];

/** Los topes vigentes en un día (si es anterior a todos, los más viejos que tengamos). */
export function topesVigentes(dia: string): Record<CategoriaMonotributo, number> {
  const vigentes = TOPES_MONOTRIBUTO.filter((t) => t.desde <= dia);
  const elegida = vigentes.at(-1) ?? TOPES_MONOTRIBUTO[0];
  if (!elegida) throw new Error('Faltan los topes del monotributo');
  return elegida.topes;
}

/** La categoría más baja que alcanza para lo facturado, o null si pasa la K. */
export function categoriaPara(centavos: number, dia: string): CategoriaMonotributo | null {
  const topes = topesVigentes(dia);
  return CATEGORIAS_MONOTRIBUTO.find((c) => centavos <= topes[c]) ?? null;
}

/**
 * Si estamos en época de recategorización (enero hasta el 5 de febrero, julio hasta el 5 de
 * agosto): hasta cuándo hay tiempo y qué 12 meses cuentan (los cerrados al semestre anterior).
 */
export function recategorizacion(
  hoy: string,
): { hasta: string; desde: string; hastaPeriodo: string } | null {
  const [a, m, d] = hoy.split('-').map(Number) as [number, number, number];
  if (m === 1 || (m === 2 && d <= 5))
    return { hasta: `${a}-02-05`, desde: `${a - 1}-01-01`, hastaPeriodo: `${a - 1}-12-31` };
  if (m === 7 || (m === 8 && d <= 5))
    return { hasta: `${a}-08-05`, desde: `${a - 1}-07-01`, hastaPeriodo: `${a}-06-30` };
  return null;
}
