import type { ReactNode } from 'react';
import { zig } from './formas.ts';

/** Papel de ticket térmico con el borde de abajo en zigzag. */
export function Ticket({ children, etiqueta }: { children: ReactNode; etiqueta: string }) {
  return (
    <section aria-label={etiqueta}>
      <div className="m-ticket">{children}</div>
      <svg
        className="m-ticket__zigzag"
        viewBox="0 0 358 10"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d={zig(358, 14, 10)} fill="currentColor" />
      </svg>
    </section>
  );
}
