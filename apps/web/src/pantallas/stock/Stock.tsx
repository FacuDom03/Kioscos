import { formatearCantidad, formatearPlata, type Unidad } from '@mostrador/shared';
import { useMemo, useState } from 'react';
import { Aviso } from '../../componentes/Formulario.tsx';
import { useEsPC } from '../../nucleo/medios.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { normalizar } from '@mostrador/shared';

interface Fila {
  id: string;
  nombre: string;
  precio: number;
  costo?: number | null;
  categoria: string | null;
  stock: number;
  minimo: number;
  unidad?: Unidad;
  ubicacion?: string | null;
}

interface Respuesta {
  conteo: { todos: number; porReponer: number };
  productos: Fila[];
}

function EstadoStock({ p }: { p: Fila }) {
  const cant = formatearCantidad(p.stock, p.unidad);
  if (p.stock <= 0) return <span className="stock stock--sin">Sin stock</span>;
  if (p.stock <= p.minimo) return <span className="stock stock--bajo">Quedan {cant}</span>;
  return <span className="stock">{cant} en stock</span>;
}

function Nivel({ p }: { p: Fila }) {
  const tope = Math.max(p.minimo * 2, p.stock, 1);
  const pct = Math.max(0, Math.min(100, (p.stock / tope) * 100));
  return (
    <span className="nivel" aria-hidden="true">
      <span
        className={`nivel__barra${p.stock <= p.minimo ? ' nivel__barra--bajo' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function Stock() {
  const s = useSesionCompleta();
  const negocio = useNegocio();
  const esPC = useEsPC();
  const [filtro, setFiltro] = useState<'todos' | 'por_reponer'>('todos');
  const [q, setQ] = useState('');
  const { datos, error } = useDatos<Respuesta>(`/api/v1/productos?filtro=${filtro}`);
  const [orden, setOrden] = useState<{ campo: 'nombre' | 'stock' | 'precio'; asc: boolean }>({
    campo: 'nombre',
    asc: true,
  });
  const editar = puede.editarCatalogo(s.rol);
  const conCostos = puede.verCostos(s.rol);

  const filas = useMemo(() => {
    const nq = normalizar(q);
    const lista = (datos?.productos ?? []).filter((p) => !nq || normalizar(p.nombre).includes(nq));
    const f = orden.campo;
    return [...lista].sort((a, b) => {
      const r = f === 'nombre' ? a.nombre.localeCompare(b.nombre, 'es') : a[f] - b[f];
      return orden.asc ? r : -r;
    });
  }, [datos, q, orden]);

  const ordenarPor = (campo: 'nombre' | 'stock' | 'precio') =>
    setOrden((o) => ({ campo, asc: o.campo === campo ? !o.asc : true }));
  const ariaOrden = (campo: string) =>
    orden.campo === campo ? (orden.asc ? 'ascending' : 'descending') : 'none';

  return (
    <div className="pantalla pantalla--ancha">
      <div className="encabezado-pantalla">
        <h1 className="m-titulo">Stock</h1>
        {editar && (
          <div className="acciones">
            <button
              type="button"
              className="m-boton m-boton--accion"
              onClick={() => navegar('/stock/compra')}
            >
              Cargar compra
            </button>
            <button
              type="button"
              className="m-boton"
              onClick={() => navegar('/stock/producto/nuevo')}
            >
              Nuevo producto
            </button>
          </div>
        )}
      </div>
      <label className="m-solo-lectores" htmlFor="buscar-stock">
        Buscar producto
      </label>
      <input
        id="buscar-stock"
        className="buscador__campo"
        type="search"
        placeholder="Buscar producto"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="chips" role="group" aria-label="Filtro">
        <button
          type="button"
          className="chip"
          aria-pressed={filtro === 'todos'}
          onClick={() => setFiltro('todos')}
        >
          Todos ({datos?.conteo.todos ?? '…'})
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={filtro === 'por_reponer'}
          onClick={() => setFiltro('por_reponer')}
        >
          {(datos?.conteo.porReponer ?? 0) > 0 && (
            <span className="punto-rojo" aria-hidden="true" />
          )}
          Por reponer ({datos?.conteo.porReponer ?? '…'})
        </button>
      </div>
      {error && <Aviso>{error}</Aviso>}

      {editar && negocio.tiene('precios_proveedor') && (
        <section className="tarjeta-aumento">
          <div>
            <h2 className="subtitulo">Listas de proveedores</h2>
            <p className="texto-suave">
              Subí la lista que te mandó un proveedor y los precios se recalculan solos.
            </p>
          </div>
          <button type="button" className="m-boton" onClick={() => navegar('/stock/proveedores')}>
            Proveedores
          </button>
        </section>
      )}

      {s.rol === 'dueno' && (
        <section className="tarjeta-aumento">
          <div>
            <h2 className="subtitulo">Aumento de un proveedor</h2>
            <p className="texto-suave">
              Subí los precios de todo, de una categoría o de algunos productos, con vista previa.
            </p>
          </div>
          <button type="button" className="m-boton" onClick={() => navegar('/stock/aumento')}>
            Aumentar precios
          </button>
        </section>
      )}

      {datos && filas.length === 0 && (
        <p className="vacio">
          {filtro === 'por_reponer'
            ? 'No hay productos por reponer.'
            : 'No hay productos. Cargá el primero o importá un archivo.'}
        </p>
      )}

      {esPC ? (
        <table className="tabla">
          <thead>
            <tr>
              <th aria-sort={ariaOrden('nombre')}>
                <button type="button" onClick={() => ordenarPor('nombre')}>
                  Producto
                </button>
              </th>
              <th>Categoría</th>
              <th aria-sort={ariaOrden('stock')} className="num">
                <button type="button" onClick={() => ordenarPor('stock')}>
                  Stock
                </button>
              </th>
              <th className="num">Mínimo</th>
              {conCostos && <th className="num">Costo</th>}
              <th aria-sort={ariaOrden('precio')} className="num">
                <button type="button" onClick={() => ordenarPor('precio')}>
                  Precio
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => (
              <tr key={p.id}>
                <td>
                  {editar ? (
                    <button
                      type="button"
                      className="enlace-tabla"
                      onClick={() => navegar(`/stock/producto/${p.id}`)}
                    >
                      {p.nombre}
                    </button>
                  ) : (
                    p.nombre
                  )}
                </td>
                <td>{p.categoria ?? '—'}</td>
                <td className="num">
                  <EstadoStock p={p} />
                </td>
                <td className="num">{formatearCantidad(p.minimo, p.unidad)}</td>
                {conCostos && (
                  <td className="num m-plata">{p.costo != null ? formatearPlata(p.costo) : '—'}</td>
                )}
                <td className="num m-plata">{formatearPlata(p.precio)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ul className="lista-filas">
          {filas.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="tarjeta-producto"
                disabled={!editar}
                onClick={() => navegar(`/stock/producto/${p.id}`)}
              >
                <span className="tarjeta-producto__nombre">{p.nombre}</span>
                <span className="tarjeta-producto__precio m-plata">{formatearPlata(p.precio)}</span>
                <span className="tarjeta-producto__stock">
                  <EstadoStock p={p} />{' '}
                  <span className="texto-suave">
                    Mínimo {formatearCantidad(p.minimo, p.unidad)}
                  </span>
                </span>
                <Nivel p={p} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editar && (
        <button type="button" className="enlace-boton" onClick={() => navegar('/stock/importar')}>
          Importar productos desde un archivo (CSV o Excel)
        </button>
      )}
    </div>
  );
}
