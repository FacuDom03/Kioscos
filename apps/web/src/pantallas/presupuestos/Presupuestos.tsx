import { formatearPlata } from '@mostrador/shared';
import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { ESTADOS, fechaCorta, type EstadoPresupuesto } from '../../nucleo/presupuestos.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface Fila {
  id: string;
  numero: number;
  para: string | null;
  total: number;
  estado: EstadoPresupuesto;
  venceEn: string;
  creadoEn: string;
  renglones: number;
}

/** Lista de presupuestos (etapa I4). */
export function Presupuestos({ alVolver }: { alVolver: () => void }) {
  const [filtro, setFiltro] = useState<'abiertos' | 'todos'>('abiertos');
  const { datos, error } = useDatos<Fila[]>(`/api/v1/presupuestos?estado=${filtro}`);
  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={alVolver} />
      <h1 className="m-titulo">Presupuestos</h1>
      <p className="texto-suave">
        Se arman desde Vender con «Guardar presupuesto». Desde acá se mandan, se imprimen y se
        cobran.
      </p>
      <div className="chips" role="group" aria-label="Filtro">
        <button
          type="button"
          className="chip"
          aria-pressed={filtro === 'abiertos'}
          onClick={() => setFiltro('abiertos')}
        >
          Abiertos
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={filtro === 'todos'}
          onClick={() => setFiltro('todos')}
        >
          Todos
        </button>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {datos && datos.length === 0 && (
        <p className="vacio">
          {filtro === 'abiertos' ? 'No hay presupuestos abiertos.' : 'Todavía no hay presupuestos.'}
        </p>
      )}
      {datos && datos.length > 0 && (
        <ul className="lista-filas">
          {datos.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="fila fila--presupuesto"
                onClick={() => navegar(`/presupuestos/${p.id}`)}
              >
                <span className="fila__texto">
                  <span className="fila__titulo">
                    Presupuesto {p.numero}
                    {p.para && ` · ${p.para}`}
                  </span>
                  <span className="texto-suave">
                    {fechaCorta(p.creadoEn)} · {p.renglones}{' '}
                    {p.renglones === 1 ? 'renglón' : 'renglones'} · vale hasta el{' '}
                    {fechaCorta(p.venceEn)}
                  </span>
                </span>
                <span className="fila__derecha">
                  <span className="m-plata">{formatearPlata(p.total)}</span>
                  <span className={`estado-presupuesto estado-presupuesto--${p.estado}`}>
                    {ESTADOS[p.estado]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
