import type { z } from 'zod';
import { datosInvalidos } from './errores.ts';

/** Valida con un esquema zod estricto. Un campo de más o de menos se rechaza con 400. */
export function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const r = esquema.safeParse(datos);
  if (!r.success) throw datosInvalidos();
  return r.data;
}
