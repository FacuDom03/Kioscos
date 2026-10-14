import { awning } from './formas.ts';

const ANCHO = 2400; // alcanza para cualquier pantalla; se recorta por el contenedor

function Rayas({ raya, alto, className }: { raya: number; alto: number; className: string }) {
  const total = alto + raya / 2;
  return (
    <svg
      className={`m-toldo ${className}`}
      viewBox={`0 0 ${ANCHO} ${total}`}
      preserveAspectRatio="xMinYMin slice"
      aria-hidden="true"
      focusable="false"
    >
      <path d={awning(ANCHO, raya, alto, true)} fill="var(--awning-a)" />
      <path d={awning(ANCHO, raya, alto, false)} fill="var(--awning-b)" />
    </svg>
  );
}

/** Franja de rayas con borde festoneado, como el toldo de un kiosco. Decorativa. */
export function Toldo() {
  return (
    <div className="m-marco__toldo">
      <Rayas raya={26} alto={12} className="m-toldo--chico" />
      <Rayas raya={32} alto={14} className="m-toldo--grande" />
    </div>
  );
}
