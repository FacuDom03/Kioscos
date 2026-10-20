// Personalización del comercio en lo que se imprime: logo arriba y texto al pie.
import { useSesion } from '../nucleo/sesion.tsx';

export interface Marca {
  /** Versión del logo (va en la dirección para que el navegador lo guarde), o null sin logo. */
  logo: number | null;
  logoEnTicket: boolean;
  marcaAgua: boolean;
  pie: string | null;
}

export const urlLogo = (version: number) => `/api/v1/personalizacion/logo?v=${version}`;

/** La personalización de la sesión (vacía si la sesión es de una versión anterior). */
export function useMarca(): Marca | null {
  const { estado } = useSesion();
  return estado.tipo === 'completa' ? (estado.kiosco.marca ?? null) : null;
}

/** Logo arriba del ticket, si hay y está activado. Sin internet sale desde lo guardado. */
export function LogoImpreso({ className = 'impreso__logo' }: { className?: string }) {
  const m = useMarca();
  if (!m?.logo || !m.logoEnTicket) return null;
  return <img className={className} src={urlLogo(m.logo)} alt="" />;
}

/** Texto al pie ("Gracias por tu compra", redes, horarios). */
export function PieImpreso({ className = 'impreso__legal' }: { className?: string }) {
  const m = useMarca();
  if (!m?.pie) return null;
  return <p className={`${className} impreso__pie`}>{m.pie}</p>;
}

/** Logo de fondo, muy claro, para lo que se imprime en hoja (presupuestos). */
export function MarcaDeAgua() {
  const m = useMarca();
  if (!m?.logo || !m.marcaAgua) return null;
  return <img className="marca-de-agua" src={urlLogo(m.logo)} alt="" />;
}
