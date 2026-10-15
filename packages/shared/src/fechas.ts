// Fechas del comercio: los días se cuentan en la hora de la Argentina, no en la del servidor.

/** El día (AAAA-MM-DD) de un momento, en la Argentina. */
export function diaArgentino(momento: Date | string = new Date()): string {
  return new Date(momento).toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/** Suma días a un día AAAA-MM-DD. */
export function sumarDias(dia: string, dias: number): string {
  const f = new Date(`${dia}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

/** "2026-10-30" → "30/10/2026". */
export function diaCorto(dia: string): string {
  const [a, m, d] = dia.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}
