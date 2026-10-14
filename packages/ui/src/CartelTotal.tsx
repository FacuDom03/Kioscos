import { formatearPlata } from '@mostrador/shared';
import { star } from './formas.ts';

interface Props {
  centavos: number;
  /** `venta`: cartel chico de la pantalla Vender. `cobro`: cartel grande de Cobrar. */
  variante?: 'venta' | 'cobro';
  etiqueta?: string;
}

const FORMAS = {
  venta: { ancho: 224, alto: 128, puntos: star(112, 64, 106, 60, 20, 0.84) },
  cobro: { ancho: 300, alto: 168, puntos: star(150, 84, 144, 80, 24, 0.86) },
} as const;

/**
 * Cartel estrella con el total. El dibujo es decorativo; el total se anuncia como texto.
 * Es el único lugar donde se usa la letra de marcador.
 */
export function CartelTotal({ centavos, variante = 'venta', etiqueta = 'Total' }: Props) {
  const f = FORMAS[variante];
  return (
    <div className={`m-cartel m-cartel--${variante}`} style={{ width: f.ancho }}>
      <svg viewBox={`0 0 ${f.ancho} ${f.alto}`} aria-hidden="true" focusable="false">
        <polygon
          points={f.puntos}
          fill="var(--star)"
          stroke="var(--star-ink)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          transform={`rotate(-5 ${f.ancho / 2} ${f.alto / 2})`}
        />
      </svg>
      <p className="m-cartel__texto" style={{ margin: 0 }}>
        <span className="m-cartel__etiqueta">{etiqueta}</span>{' '}
        <span className="m-cartel__monto">{formatearPlata(centavos)}</span>
      </p>
    </div>
  );
}
