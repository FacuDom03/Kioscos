import { formatearCantidad, formatearPlata } from '@mostrador/shared';
import { useEffect, useRef } from 'react';
import { grupoPorId, variantesDe } from '../../nucleo/catalogo.ts';
import { precioEnLista, sumarProducto, useLista, useTicket } from '../../nucleo/ticket.ts';

const PREGUNTA = {
  tono: '¿Qué tono?',
  tamano: '¿Qué tamaño?',
  aroma: '¿Qué aroma?',
  talle: '¿Qué talle?',
  otro: '¿Cuál?',
} as const;

/**
 * Elegir el tono (o el tamaño) de un producto con variantes. Cada toque suma uno al ticket, así
 * se cargan tres esmaltes de tonos distintos sin volver a buscar.
 */
export function ElegirVariante({
  grupoId,
  alSumar,
  alCerrar,
}: {
  grupoId: string;
  alSumar: () => void;
  alCerrar: () => void;
}) {
  const grupo = grupoPorId(grupoId);
  const variantes = variantesDe(grupoId);
  const lista = useLista();
  const items = useTicket();
  const listo = useRef<HTMLButtonElement>(null);
  const primero = useRef<HTMLButtonElement>(null);
  useEffect(() => primero.current?.focus(), []);

  const enTicket = (id: string) =>
    items.filter((x) => x.productoId === id).reduce((t, x) => t + x.cantidad, 0);

  return (
    <dialog
      className="dialogo dialogo--variantes"
      open
      aria-labelledby="titulo-variante"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          alCerrar();
        }
      }}
    >
      <h2 id="titulo-variante" className="subtitulo">
        {grupo?.nombre ?? 'Variantes'}
      </h2>
      <p className="texto-suave">{PREGUNTA[grupo?.tipo ?? 'otro']} Cada toque suma uno.</p>
      <ul className="variantes" aria-label="Variantes">
        {variantes.map((v, i) => {
          const n = enTicket(v.id);
          return (
            <li key={v.id}>
              <button
                ref={i === 0 ? primero : undefined}
                type="button"
                className="variante"
                aria-label={`${v.variante}, ${formatearPlata(precioEnLista(v, lista))}, quedan ${formatearCantidad(v.stock)}${n ? `, ${formatearCantidad(n)} en el ticket` : ''}`}
                onClick={() => {
                  sumarProducto(v);
                  alSumar();
                }}
              >
                <span
                  className={`variante__muestra${v.color ? '' : ' variante__muestra--sin-color'}`}
                  style={v.color ? { background: v.color } : undefined}
                  aria-hidden="true"
                />
                <span className="variante__nombre">{v.variante}</span>
                <span className="variante__info">
                  {formatearPlata(precioEnLista(v, lista))} ·{' '}
                  {v.stock > 0 ? `Quedan ${formatearCantidad(v.stock)}` : 'Sin stock'}
                </span>
                {n > 0 && (
                  <span className="variante__cuantos" aria-hidden="true">
                    {formatearCantidad(n)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="acciones">
        <button ref={listo} type="button" className="m-boton m-boton--principal" onClick={alCerrar}>
          Listo
        </button>
      </div>
    </dialog>
  );
}
