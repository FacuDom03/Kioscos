import { formatearPlata } from '@mostrador/shared';
import { useState } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { BuscadorProductos } from '../../componentes/BuscadorProductos.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo, type Producto } from '../../nucleo/catalogo.ts';
import { navegar } from '../../nucleo/ruta.ts';

interface Item {
  producto: Producto;
  cantidad: string;
  costo: number | null;
  margen: string;
}

export function CargarCompra() {
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const agregar = (p: Producto) => {
    setItems((xs) =>
      xs.some((x) => x.producto.id === p.id)
        ? xs
        : [...xs, { producto: p, cantidad: '1', costo: p.costo ?? null, margen: '' }],
    );
  };
  const cambiar = (i: number, cambio: Partial<Item>) =>
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...cambio } : x)));
  const total = items.reduce(
    (t, x) => t + Math.round((Number(x.cantidad.replace(',', '.')) || 0) * (x.costo ?? 0)),
    0,
  );

  async function guardar() {
    setError(null);
    const cuerpo = items.map((x) => ({
      productoId: x.producto.id,
      cantidad: Number(x.cantidad.replace(',', '.')),
      costoUnitario: x.costo ?? -1,
      ...(x.margen.trim() ? { margen: Number(x.margen.replace(',', '.')) } : {}),
    }));
    if (cuerpo.some((c) => !(c.cantidad > 0) || c.costoUnitario < 0)) {
      setError('Revisá que cada producto tenga cantidad y costo.');
      return;
    }
    setGuardando(true);
    try {
      await api('POST', '/api/v1/compras', {
        items: cuerpo,
        ...(nota.trim() ? { nota: nota.trim() } : {}),
      });
      await refrescarCatalogo();
      navegar('/stock');
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Cargar compra</h1>
      <p className="texto-suave">
        Escaneá o buscá cada producto que llegó, con la cantidad y el costo por unidad.{' '}
        <button
          type="button"
          className="enlace-boton"
          onClick={() => navegar('/historial?ver=compras')}
        >
          Ver compras anteriores
        </button>
      </p>
      <BuscadorProductos
        alElegir={agregar}
        etiqueta="Agregar producto"
        ayudaEscaner="Cada producto leído se suma a la compra."
      />
      <ul className="lista-filas">
        {items.map((x, i) => (
          <li key={x.producto.id} className="tarjeta tarjeta--compra">
            <strong className="tarjeta--compra__nombre">{x.producto.nombre}</strong>
            <div className="campo">
              <label htmlFor={`cant-${i}`}>Cantidad</label>
              <input
                id={`cant-${i}`}
                className="campo__entrada"
                inputMode="decimal"
                value={x.cantidad}
                onChange={(e) => cambiar(i, { cantidad: e.target.value })}
              />
            </div>
            <CampoPlata
              etiqueta="Costo por unidad"
              valor={x.costo}
              alCambiar={(c) => cambiar(i, { costo: c })}
            />
            <div className="campo">
              <label htmlFor={`margen-${i}`}>Margen % (opcional)</label>
              <input
                id={`margen-${i}`}
                className="campo__entrada"
                inputMode="decimal"
                placeholder="Deja el precio igual"
                value={x.margen}
                onChange={(e) => cambiar(i, { margen: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="enlace-boton"
              onClick={() => setItems(items.filter((_, j) => j !== i))}
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <>
          <div className="campo">
            <label htmlFor="nota-compra">Nota (opcional, por ejemplo el proveedor)</label>
            <input
              id="nota-compra"
              className="campo__entrada"
              value={nota}
              maxLength={500}
              onChange={(e) => setNota(e.target.value)}
            />
          </div>
          <p className="total-linea">
            Total de la compra: <strong className="m-plata">{formatearPlata(total)}</strong>
          </p>
        </>
      )}
      {error && <Aviso>{error}</Aviso>}
      <button
        type="button"
        className="m-boton m-boton--principal"
        disabled={!items.length || guardando}
        onClick={guardar}
      >
        Guardar compra
      </button>
    </div>
  );
}
