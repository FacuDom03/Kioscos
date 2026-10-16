import { useState } from 'react';
import {
  DetalleHistorial,
  ElegirPeriodo,
  ListaVentas,
  parametro,
  rango,
  type Periodo,
} from '../../componentes/Historial.tsx';

/** Sección Ventas: lo que se vendió, con el detalle de cada venta. */
export function Ventas() {
  const [periodo, setPeriodo] = useState<Periodo>(1);
  const [turno, setTurno] = useState<string | null>(() => parametro('turno'));
  const [abierta, setAbierta] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  return (
    <div className="pantalla pantalla--ancha">
      <h1 className="m-titulo">Ventas</h1>
      {!turno && <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />}
      <ListaVentas
        key={version}
        url={turno ? `/api/v1/ventas?turnoId=${turno}` : `/api/v1/ventas?${rango(periodo)}`}
        deUnTurno={!!turno}
        alQuitarTurno={() => setTurno(null)}
        alAbrir={setAbierta}
      />
      {abierta && (
        <DetalleHistorial
          detalle={{ tipo: 'venta', id: abierta }}
          alCerrar={() => setAbierta(null)}
          alCambiar={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}
