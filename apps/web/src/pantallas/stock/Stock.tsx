import { formatearCantidad, formatearPlata, type Unidad } from '@mostrador/shared';
import { useMemo, useState } from 'react';
import { Escaner } from '../../componentes/Escaner.tsx';
import { Aviso } from '../../componentes/Formulario.tsx';
import { productoPorCodigo } from '../../nucleo/catalogo.ts';
import { enlaceWhatsApp } from '../../nucleo/presupuestos.ts';
import { descargar, hoyArgentina } from '../../nucleo/descargar.ts';
import { mensajeDeError } from '../../nucleo/api.ts';
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
  // Sin mínimo cargado la barra siempre estaría llena y no diría nada.
  if (p.minimo <= 0) return null;
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
  const [escaner, setEscaner] = useState(false);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const { datos, error } = useDatos<Respuesta>(`/api/v1/productos?filtro=${filtro}`);
  const [orden, setOrden] = useState<{ campo: 'nombre' | 'stock' | 'precio'; asc: boolean }>({
    campo: 'nombre',
    asc: true,
  });
  const editar = puede.editarCatalogo(s.rol);
  const conCostos = puede.verCostos(s.rol);

  const filas = useMemo(() => {
    const nq = normalizar(q);
    // Un código escaneado o tipeado muestra solo ese producto.
    const porCodigo = productoPorCodigo(q.trim());
    const lista = (datos?.productos ?? []).filter((p) =>
      porCodigo ? p.id === porCodigo.id : !nq || normalizar(p.nombre).includes(nq),
    );
    const f = orden.campo;
    return [...lista].sort((a, b) => {
      const r = f === 'nombre' ? a.nombre.localeCompare(b.nombre, 'es') : a[f] - b[f];
      return orden.asc ? r : -r;
    });
  }, [datos, q, orden]);

  // Un código (de 6 cifras o más) que no está en el catálogo: se ofrece cargarlo.
  const codigoDesconocido =
    /^\d{6,}$/.test(q.trim()) && !productoPorCodigo(q.trim()) ? q.trim() : null;

  // Columnas que no dicen nada si ningún producto tiene el dato cargado.
  const todos = datos?.productos ?? [];
  const conCategoria = todos.some((p) => p.categoria);
  const conMinimo = todos.some((p) => p.minimo > 0);
  const conCosto = conCostos && todos.some((p) => p.costo != null);

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
              onClick={() => navegar('/stock/producto/nuevo')}
            >
              Nuevo producto
            </button>
          </div>
        )}
      </div>
      <div className="buscador">
        <label className="m-solo-lectores" htmlFor="buscar-stock">
          Buscar producto
        </label>
        <input
          id="buscar-stock"
          className="buscador__campo"
          type="search"
          placeholder="Buscar o escanear"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="buscador__escanear" onClick={() => setEscaner(true)}>
          Escanear
        </button>
      </div>
      {codigoDesconocido && (
        <div className="aviso aviso--error desconocido" role="alert">
          <p>No encontramos el código {codigoDesconocido}.</p>
          {editar && (
            <button
              type="button"
              className="m-boton"
              onClick={() =>
                navegar(`/stock/producto/nuevo?codigo=${encodeURIComponent(codigoDesconocido)}`)
              }
            >
              Cargar producto
            </button>
          )}
        </div>
      )}
      {escaner && (
        <Escaner
          ayuda="Apuntá al código para ver su precio y su stock."
          alLeer={(codigo) => {
            setQ(codigo);
            setEscaner(false);
          }}
          alCerrar={() => setEscaner(false)}
        />
      )}
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
      {errorDescarga && <Aviso>{errorDescarga}</Aviso>}
      {filtro === 'por_reponer' && filas.length > 0 && (
        <a
          className="m-boton boton-enlace"
          href={enlaceWhatsApp(
            [
              `Pedido de ${s.kiosco.nombre}:`,
              ...filas.map(
                (p) =>
                  `- ${p.nombre} (quedan ${formatearCantidad(p.stock, p.unidad)}, mínimo ${formatearCantidad(p.minimo, p.unidad)})`,
              ),
            ].join('\n'),
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mandar la lista por WhatsApp
        </a>
      )}

      {editar || negocio.tiene('variantes') || negocio.tiene('vencimientos') ? (
        <div className="herramientas" role="group" aria-label="Más herramientas de stock">
          {s.rol === 'dueno' && (
            <button type="button" className="m-boton" onClick={() => navegar('/stock/aumento')}>
              Aumentar precios
            </button>
          )}
          {negocio.tiene('variantes') && (
            <button type="button" className="m-boton" onClick={() => navegar('/stock/variantes')}>
              Tonos y tamaños
            </button>
          )}
          {negocio.tiene('vencimientos') && (
            <button
              type="button"
              className="m-boton"
              onClick={() => navegar('/stock/vencimientos')}
            >
              Ver vencimientos
            </button>
          )}
          {editar && (
            <button type="button" className="m-boton" onClick={() => navegar('/stock/movimientos')}>
              Movimientos
            </button>
          )}
          {editar && (
            <button type="button" className="m-boton" onClick={() => navegar('/stock/importar')}>
              Importar productos
            </button>
          )}
          {editar && (
            <button
              type="button"
              className="m-boton"
              onClick={() => {
                setErrorDescarga(null);
                descargar('/api/v1/exportar/productos.xlsx', `stock-${hoyArgentina()}.xlsx`).catch(
                  (e: unknown) => setErrorDescarga(mensajeDeError(e)),
                );
              }}
            >
              Descargar mi stock (Excel)
            </button>
          )}
        </div>
      ) : null}

      {datos && filas.length === 0 && !codigoDesconocido && (
        <p className="vacio">
          {filtro === 'por_reponer'
            ? 'No hay productos por reponer.'
            : q.trim()
              ? 'No hay productos con ese nombre.'
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
              {conCategoria && <th>Categoría</th>}
              <th aria-sort={ariaOrden('stock')} className="num">
                <button type="button" onClick={() => ordenarPor('stock')}>
                  Stock
                </button>
              </th>
              {conMinimo && <th className="num">Mínimo</th>}
              {conCosto && <th className="num">Costo</th>}
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
                {conCategoria && <td>{p.categoria ?? '—'}</td>}
                <td className="num">
                  <EstadoStock p={p} />
                </td>
                {conMinimo && (
                  <td className="num">
                    {p.minimo > 0 ? formatearCantidad(p.minimo, p.unidad) : '—'}
                  </td>
                )}
                {conCosto && (
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
                  <EstadoStock p={p} />
                  {p.minimo > 0 && (
                    <span className="texto-suave">
                      {' '}
                      Mínimo {formatearCantidad(p.minimo, p.unidad)}
                    </span>
                  )}
                </span>
                <Nivel p={p} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
