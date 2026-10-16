import { formatearPlata } from '@mostrador/shared';
import { useId, useState } from 'react';
import { buscarProductos, productoPorCodigo, type Producto } from '../nucleo/catalogo.ts';
import { Escaner } from './Escaner.tsx';

/** Buscador con lista de resultados navegable con teclado. Enter con un código exacto lo elige. */
export function BuscadorProductos({
  alElegir,
  etiqueta,
  ayudaEscaner,
}: {
  alElegir: (p: Producto) => void;
  etiqueta: string;
  /** Con esto aparece el botón Escanear (cámara del celular o la tablet). */
  ayudaEscaner?: string;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const [escaner, setEscaner] = useState(false);
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const resultados = q.trim() ? buscarProductos(q, 8) : [];

  const elegir = (p: Producto) => {
    alElegir(p);
    setQ('');
    setActivo(0);
    setDesconocido(null);
  };

  return (
    <div className={`buscador-productos${ayudaEscaner ? ' buscador' : ''}`}>
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
          setDesconocido(null);
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
      {ayudaEscaner && (
        <button type="button" className="buscador__escanear" onClick={() => setEscaner(true)}>
          Escanear
        </button>
      )}
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
      {desconocido && (
        <p className="buscador__desconocido" role="alert">
          No encontramos el código {desconocido}. Cargalo primero desde Nuevo producto.
        </p>
      )}
      {escaner && ayudaEscaner && (
        <Escaner
          ayuda={ayudaEscaner}
          alLeer={(codigo) => {
            const p = productoPorCodigo(codigo);
            if (p) elegir(p);
            else setDesconocido(codigo);
          }}
          alCerrar={() => setEscaner(false)}
        />
      )}
    </div>
  );
}
