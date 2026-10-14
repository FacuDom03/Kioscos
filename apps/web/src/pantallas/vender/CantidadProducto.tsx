import {
  DATOS_UNIDADES,
  formatearCantidad,
  formatearPlata,
  parsearCantidad,
  subtotal,
  type Unidad,
} from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { Campo } from '../../componentes/Formulario.tsx';
import type { Producto } from '../../nucleo/catalogo.ts';
import { precioEnLista, sumarProducto, useLista } from '../../nucleo/ticket.ts';

const RAPIDOS: Partial<Record<Unidad, string[]>> = {
  metro: ['1', '5', '10', '25'],
  kilo: ['0,25', '0,5', '1', '2'],
  litro: ['0,5', '1', '4', '10'],
};

/** Pide cuánto llevar de un producto que se vende fraccionado (metro, kilo, litro). */
export function CantidadProducto({
  producto,
  alCerrar,
}: {
  producto: Producto;
  alCerrar: () => void;
}) {
  const unidad = producto.unidad ?? 'unidad';
  const datos = DATOS_UNIDADES[unidad];
  const lista = useLista();
  const precio = precioEnLista(producto, lista);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const cantidad = parsearCantidad(texto, unidad);

  function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (cantidad === null) {
      setError(`Poné cuánto lleva, por ejemplo ${unidad === 'kilo' ? '0,750' : '12,5'}.`);
      return;
    }
    sumarProducto(producto, cantidad);
    alCerrar();
  }

  return (
    <dialog
      className="dialogo"
      open
      aria-labelledby="titulo-cantidad"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          alCerrar();
        }
      }}
    >
      <form className="formulario" onSubmit={enviar}>
        <h2 id="titulo-cantidad" className="subtitulo">
          {producto.nombre}
        </h2>
        <p className="texto-suave">
          {formatearPlata(precio)} {datos.precioPor}
          {lista === 'gremio' && ' (gremio)'}
          {producto.ubicacion && ` · ${producto.ubicacion}`} · Quedan{' '}
          {formatearCantidad(producto.stock, unidad)}
        </p>
        <Campo
          etiqueta={datos.pregunta}
          name="cantidad"
          inputMode="decimal"
          autoComplete="off"
          autoFocus
          value={texto}
          error={error}
          onChange={(e) => {
            setTexto(e.target.value);
            setError(null);
          }}
        />
        {RAPIDOS[unidad] && (
          <div className="chips" role="group" aria-label="Cantidades rápidas">
            {RAPIDOS[unidad].map((r) => (
              <button
                key={r}
                type="button"
                className="chip"
                onClick={() => {
                  setTexto(r);
                  setError(null);
                }}
              >
                {r} {datos.corta}
              </button>
            ))}
          </div>
        )}
        <div className="acciones">
          <button className="m-boton m-boton--principal">
            {cantidad === null
              ? 'Sumar al ticket'
              : `Sumar ${formatearCantidad(cantidad, unidad)} · ${formatearPlata(subtotal(cantidad, precio))}`}
          </button>
          <button type="button" className="m-boton" onClick={alCerrar}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
