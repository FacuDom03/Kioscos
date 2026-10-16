import { useState } from 'react';
import {
  DetalleHistorial,
  ElegirPeriodo,
  ListaCompras,
  rango,
  type Periodo,
} from '../../componentes/Historial.tsx';
import { navegar } from '../../nucleo/ruta.ts';
import { useNegocio } from '../../nucleo/rubro.ts';

/** Sección Compras: cargar lo que llegó, ver las compras anteriores y los proveedores. */
export function Compras() {
  const negocio = useNegocio();
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [abierta, setAbierta] = useState<string | null>(null);
  return (
    <div className="pantalla pantalla--ancha">
      <div className="encabezado-pantalla">
        <h1 className="m-titulo">Compras</h1>
        <div className="acciones">
          <button
            type="button"
            className="m-boton m-boton--accion"
            onClick={() => navegar('/compras/nueva')}
          >
            Cargar compra
          </button>
          {negocio.tiene('precios_proveedor') && (
            <button
              type="button"
              className="m-boton"
              onClick={() => navegar('/compras/proveedores')}
            >
              Proveedores
            </button>
          )}
        </div>
      </div>
      <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />
      <ListaCompras url={`/api/v1/compras?${rango(periodo)}`} alAbrir={setAbierta} />
      {abierta && (
        <DetalleHistorial
          detalle={{ tipo: 'compra', id: abierta }}
          alCerrar={() => setAbierta(null)}
        />
      )}
    </div>
  );
}
