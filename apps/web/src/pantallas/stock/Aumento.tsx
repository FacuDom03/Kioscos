import { formatearPlata } from '@mostrador/shared';
import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo, useCatalogo } from '../../nucleo/catalogo.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface Cambio {
  producto_id: string;
  nombre: string;
  antes: number;
  despues: number;
}

interface Historial {
  id: string;
  alcance: string;
  categoria: string | null;
  porcentaje: number;
  productos: number;
  deshecho_en: string | null;
  created_at: string;
  nombre: string | null;
}

export function AumentoPrecios() {
  const { catalogo } = useCatalogo();
  const historial = useDatos<Historial[]>('/api/v1/precios/aumentos');
  const [alcance, setAlcance] = useState<'todo' | 'categoria' | 'seleccion'>('todo');
  const [categoriaId, setCategoriaId] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [porcentaje, setPorcentaje] = useState('10');
  const [redondeo, setRedondeo] = useState<1000 | 5000 | 10000>(5000);
  const [vista, setVista] = useState<Cambio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const datos = () => ({
    alcance,
    redondeo,
    porcentaje: Number(porcentaje.replace(',', '.')),
    ...(alcance === 'categoria' ? { categoriaId } : {}),
    ...(alcance === 'seleccion' ? { productoIds: [...seleccion] } : {}),
  });

  async function verVista() {
    setError(null);
    setAviso(null);
    try {
      setVista(
        (await api<{ cambios: Cambio[] }>('POST', '/api/v1/precios/vista-previa', datos())).cambios,
      );
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function aplicar() {
    try {
      const r = await api<{ productos: number }>('POST', '/api/v1/precios/aumentos', datos());
      setVista(null);
      setAviso(
        `Listo, cambiaron ${r.productos} precios. Si te equivocaste, podés deshacerlo abajo.`,
      );
      await Promise.all([refrescarCatalogo(), historial.recargar()]);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function deshacer(id: string) {
    if (!confirm('¿Volver los precios a como estaban antes de este aumento?')) return;
    try {
      const r = await api<{ restaurados: number; saltados: number }>(
        'POST',
        `/api/v1/precios/aumentos/${id}/deshacer`,
        {},
      );
      setAviso(
        r.saltados
          ? `Volvieron ${r.restaurados} precios. ${r.saltados} no se tocaron porque se cambiaron después a mano.`
          : `Volvieron ${r.restaurados} precios a como estaban.`,
      );
      await Promise.all([refrescarCatalogo(), historial.recargar()]);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  const cambian = vista?.filter((c) => c.antes !== c.despues) ?? [];

  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Aumentar precios</h1>
      <fieldset className="campo">
        <legend>¿A qué productos?</legend>
        <div className="chips">
          {(['todo', 'categoria', 'seleccion'] as const).map((a) => (
            <label key={a} className="chip chip--radio">
              <input
                type="radio"
                name="alcance"
                checked={alcance === a}
                onChange={() => {
                  setAlcance(a);
                  setVista(null);
                }}
              />
              {a === 'todo' ? 'Todos' : a === 'categoria' ? 'Una categoría' : 'Algunos'}
            </label>
          ))}
        </div>
      </fieldset>
      {alcance === 'categoria' && (
        <div className="campo">
          <label htmlFor="cat-aumento">Categoría</label>
          <select
            id="cat-aumento"
            className="campo__entrada"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            <option value="">Elegí una</option>
            {catalogo?.categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      )}
      {alcance === 'seleccion' && (
        <fieldset className="campo lista-seleccion">
          <legend>Productos</legend>
          {catalogo?.productos.map((p) => (
            <label key={p.id} className="opcion">
              <input
                type="checkbox"
                checked={seleccion.has(p.id)}
                onChange={(e) => {
                  const n = new Set(seleccion);
                  if (e.target.checked) n.add(p.id);
                  else n.delete(p.id);
                  setSeleccion(n);
                }}
              />
              {p.nombre}
            </label>
          ))}
        </fieldset>
      )}
      <div className="dos-columnas">
        <div className="campo">
          <label htmlFor="pct">Porcentaje de aumento</label>
          <input
            id="pct"
            className="campo__entrada"
            inputMode="decimal"
            value={porcentaje}
            onChange={(e) => {
              setPorcentaje(e.target.value);
              setVista(null);
            }}
          />
        </div>
        <div className="campo">
          <label htmlFor="redondeo">Redondear al</label>
          <select
            id="redondeo"
            className="campo__entrada"
            value={redondeo}
            onChange={(e) => {
              setRedondeo(Number(e.target.value) as 1000);
              setVista(null);
            }}
          >
            <option value={1000}>$ 10 más cercano</option>
            <option value={5000}>$ 50 más cercano</option>
            <option value={10000}>$ 100 más cercano</option>
          </select>
        </div>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {!vista ? (
        <button type="button" className="m-boton m-boton--principal" onClick={verVista}>
          Ver cómo quedan
        </button>
      ) : (
        <>
          <h2 className="subtitulo">Vista previa: cambian {cambian.length} precios</h2>
          <table className="tabla tabla--compacta">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Antes</th>
                <th className="num">Después</th>
              </tr>
            </thead>
            <tbody>
              {cambian.slice(0, 300).map((c) => (
                <tr key={c.producto_id}>
                  <td>{c.nombre}</td>
                  <td className="num m-plata">{formatearPlata(c.antes)}</td>
                  <td className="num m-plata">
                    <strong>{formatearPlata(c.despues)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cambian.length > 300 && <p className="texto-suave">Y {cambian.length - 300} más.</p>}
          <div className="acciones">
            <button
              type="button"
              className="m-boton m-boton--principal"
              disabled={!cambian.length}
              onClick={aplicar}
            >
              Aplicar aumento
            </button>
            <button type="button" className="m-boton" onClick={() => setVista(null)}>
              Cambiar algo
            </button>
          </div>
        </>
      )}

      <h2 className="subtitulo">Aumentos anteriores</h2>
      <ul className="lista-filas">
        {historial.datos?.map((h) => (
          <li key={h.id} className="tarjeta">
            <div>
              <strong>
                {h.porcentaje > 0 ? '+' : ''}
                {h.porcentaje.toLocaleString('es-AR')} % ·{' '}
                {h.alcance === 'todo'
                  ? 'Todos'
                  : h.alcance === 'categoria'
                    ? (h.categoria ?? 'Categoría')
                    : 'Algunos'}
              </strong>
              <p className="texto-suave">
                {h.productos} productos · {new Date(h.created_at).toLocaleString('es-AR')} ·{' '}
                {h.nombre}
                {h.deshecho_en && ' · Deshecho'}
              </p>
            </div>
            {!h.deshecho_en && (
              <button type="button" className="m-boton" onClick={() => deshacer(h.id)}>
                Deshacer
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
