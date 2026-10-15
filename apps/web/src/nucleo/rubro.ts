// Rubro del comercio en la app: estilo, tema por defecto y funciones activas.
import { DATOS_RUBROS, esRubro, moduloEnPlan, type Modulo, type Rubro } from '@mostrador/shared';
import { aplicarEstilo } from '@mostrador/ui';
import { useSesionCompleta } from './sesion.tsx';

/** Aplica el estilo del rubro y su tema si el del equipo no corresponde. */
export function aplicarRubro(rubro: Rubro): void {
  const d = DATOS_RUBROS[rubro];
  aplicarEstilo(d.estilo, d.tema);
}

export function rubroDe(valor: unknown): Rubro {
  return esRubro(valor) ? valor : 'kiosco';
}

/** Rubro y funciones del comercio de la sesión. */
export function useNegocio() {
  const s = useSesionCompleta();
  const rubro = rubroDe(s.kiosco.rubro);
  const modulos: readonly Modulo[] = s.kiosco.modulos ?? [];
  // Una función que el plan no incluye no se muestra aunque haya quedado activada.
  return {
    rubro,
    modulos,
    tiene: (m: Modulo) => modulos.includes(m) && moduloEnPlan(m, s.kiosco.plan),
  };
}
