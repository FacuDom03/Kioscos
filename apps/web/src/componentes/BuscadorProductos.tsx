import { formatearPlata } from '@mostrador/shared';
import { useId, useState } from 'react';
import { buscarProductos, productoPorCodigo, type Producto } from '../nucleo/catalogo.ts';

/** Buscador con lista de resultados navegable con teclado. Enter con un código exacto lo elige. */
export function BuscadorProductos({
  alElegir,
  etiqueta,
}: {
  alElegir: (p: Producto) => void;
  etiqueta: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const resultados = q.trim() ? buscarProductos(q, 8) : [];

  const elegir = (p: Producto) => {
    alElegir(p);
    setQ('');
    setActivo(0);
  };

  return (
    <div className="buscador-productos">
      <label className="m-solo-lectores" htmlFor={id}>
        {etiqueta}
      </label>
      <input
        id={id}
        className="buscador__campo"
        type="search"
        placeholder="Escaneá o buscá un producto"
        value={q}
        role="combobox"
        aria-expanded={resultados.length > 0}
        aria-controls={`${id}-lista`}
        aria-activedescendant={resultados[activo] ? `${id}-${resultados[activo].id}` : undefined}
        onChange={(e) => {
          setQ(e.target.value);
          setActivo(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActivo((a) => Math.min(a + 1, resultados.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActivo((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const exacto = productoPorCodigo(q.trim());
            const p = exacto ?? resultados[activo];
            if (p) elegir(p);
          }
        }}
      />
      {resultados.length > 0 && (
        <ul id={`${id}-lista`} role="listbox" className="resultados">
          {resultados.map((p, i) => (
            <li key={p.id} id={`${id}-${p.id}`} role="option" aria-selected={i === activo}>
              <button type="button" className="resultado" tabIndex={-1} onClick={() => elegir(p)}>
                <span>{p.nombre}</span>
                <span className="m-plata">{formatearPlata(p.precio)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
