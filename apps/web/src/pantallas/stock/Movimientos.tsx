import { useState } from 'react';
import { BuscadorProductos } from '../../componentes/BuscadorProductos.tsx';
import { Volver } from '../../componentes/Formulario.tsx';
import {
  DetalleHistorial,
  ElegirPeriodo,
  ListaMovimientos,
  parametro,
  rango,
  type Detalle,
  type Periodo,
} from '../../componentes/Historial.tsx';
import { productoPorId } from '../../nucleo/catalogo.ts';
import { navegar } from '../../nucleo/ruta.ts';

/** Movimientos de stock: cada venta, compra, ajuste y anulación que movió un producto. */
export function Movimientos() {
  const [periodo, setPeriodo] = useState<Periodo>(7);
  const [producto, setProducto] = useState<{ id: string; nombre: string } | null>(() => {
    const p = productoPorId(parametro('producto') ?? '');
    return p ? { id: p.id, nombre: p.nombre } : null;
  });
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Movimientos de stock</h1>
      {producto ? (
        <p className="filtro-producto">
          Solo <strong>{producto.nombre}</strong>{' '}
          <button type="button" className="enlace-boton" onClick={() => setProducto(null)}>
            Ver todos
          </button>
        </p>
      ) : (
        <BuscadorProductos
          etiqueta="Ver los movimientos de un producto"
          alElegir={(p) => setProducto({ id: p.id, nombre: p.nombre })}
        />
      )}
      <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />
      <ListaMovimientos
        url={`/api/v1/movimientos-stock?${rango(periodo)}${producto ? `&productoId=${producto.id}` : ''}`}
        alAbrir={setDetalle}
      />
      {detalle && <DetalleHistorial detalle={detalle} alCerrar={() => setDetalle(null)} />}
    </div>
  );
}
