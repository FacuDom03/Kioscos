import type { ReactNode } from 'react';
import {
  IconoCaja,
  IconoCompras,
  IconoMas,
  IconoStock,
  IconoTablero,
  IconoVender,
  IconoVentas,
} from './Iconos.tsx';
import { Toldo } from './Toldo.tsx';

export type Seccion = 'vender' | 'ventas' | 'compras' | 'stock' | 'caja' | 'tablero' | 'mas';

const SECCIONES: { id: Seccion; nombre: string; Icono: () => ReactNode }[] = [
  { id: 'vender', nombre: 'Vender', Icono: IconoVender },
  { id: 'ventas', nombre: 'Ventas', Icono: IconoVentas },
  { id: 'compras', nombre: 'Compras', Icono: IconoCompras },
  { id: 'stock', nombre: 'Stock', Icono: IconoStock },
  { id: 'caja', nombre: 'Caja', Icono: IconoCaja },
  { id: 'tablero', nombre: 'Tablero', Icono: IconoTablero },
  { id: 'mas', nombre: 'Más', Icono: IconoMas },
];

interface Props {
  seccion: Seccion;
  alCambiar: (s: Seccion) => void;
  /** Estado de conexión, en palabras. En PC va al pie de la barra lateral. */
  estado: ReactNode;
  /** Secciones que esta persona no usa (al cajero no se le muestran Compras ni Tablero). */
  ocultas?: readonly Seccion[];
  children: ReactNode;
}

/**
 * Marco de la app: toldo, contenido y navegación.
 * Celular y tablet: barra abajo. Computadora con puntero fino: barra lateral con el estado.
 */
export function Marco({ seccion, alCambiar, estado, ocultas = [], children }: Props) {
  return (
    <div className="m-marco">
      <Toldo />
      <main className="m-marco__contenido" id="contenido">
        {children}
      </main>
      <nav className="m-nav" aria-label="Secciones">
        <ul className="m-nav__lista">
          {SECCIONES.filter((x) => !ocultas.includes(x.id)).map(({ id, nombre, Icono }) => (
            <li key={id}>
              <button
                type="button"
                className="m-nav__item"
                aria-current={seccion === id ? 'page' : undefined}
                onClick={() => alCambiar(id)}
              >
                <Icono />
                {nombre}
              </button>
            </li>
          ))}
        </ul>
        <div className="m-nav__estado">{estado}</div>
      </nav>
    </div>
  );
}
