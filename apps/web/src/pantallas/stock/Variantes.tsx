import { formatearCantidad, formatearPlata, uuidv7 } from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { refrescarCatalogo, useCatalogo, type GrupoVariantes } from '../../nucleo/catalogo.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useDatos } from '../../nucleo/usar-datos.ts';

type Tipo = GrupoVariantes['tipo'];

export const TIPOS: Record<Tipo, { nombre: string; plural: string; ejemplo: string }> = {
  tono: { nombre: 'Tono', plural: 'tonos', ejemplo: 'Rojo' },
  tamano: { nombre: 'Tamaño', plural: 'tamaños', ejemplo: '100 ml' },
  aroma: { nombre: 'Aroma', plural: 'aromas', ejemplo: 'Lavanda' },
  talle: { nombre: 'Talle', plural: 'talles', ejemplo: 'M' },
  otro: { nombre: 'Variante', plural: 'variantes', ejemplo: 'Mate' },
};

interface Fila {
  id: string;
  nombre: string;
  tipo: Tipo;
  variantes: number;
  stock: number;
}

/** Productos con variantes (etapa I7): la lista y el alta. */
export function Variantes() {
  const s = useSesionCompleta();
  const { datos, error } = useDatos<Fila[]>('/api/v1/grupos-variantes');
  return (
    <div className="pantalla">
      <Volver onClick={() => navegar('/stock')} />
      <h1 className="m-titulo">Tonos y tamaños</h1>
      <p className="texto-suave">
        Un producto que viene en varios tonos o tamaños. Cada uno tiene su stock y su código, y en
        Vender se elige tocando el tono.
      </p>
      {puede.editarCatalogo(s.rol) && (
        <button
          type="button"
          className="m-boton m-boton--principal"
          onClick={() => navegar('/stock/variantes/nuevo')}
        >
          Nuevo producto con tonos
        </button>
      )}
      {error && <Aviso>{error}</Aviso>}
      {datos && datos.length === 0 && (
        <p className="vacio">Todavía no cargaste productos con tonos o tamaños.</p>
      )}
      {datos && datos.length > 0 && (
        <ul className="lista-filas">
          {datos.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className="fila"
                onClick={() => navegar(`/stock/variantes/${g.id}`)}
              >
                <span className="fila__texto">
                  <span className="fila__titulo">{g.nombre}</span>
                  <span className="texto-suave">
                    {g.variantes}{' '}
                    {g.variantes === 1 ? TIPOS[g.tipo].nombre.toLowerCase() : TIPOS[g.tipo].plural}{' '}
                    · Quedan {formatearCantidad(g.stock)}
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

interface RenglonNuevo {
  clave: string;
  variante: string;
  color: string;
  codigo: string;
  stock: string;
}

const renglon = (): RenglonNuevo => ({
  clave: uuidv7(),
  variante: '',
  color: '#c0182b',
  codigo: '',
  stock: '',
});

/** Alta de un producto con todas sus variantes. */
export function NuevoGrupo() {
  const { catalogo } = useCatalogo();
  const [tipo, setTipo] = useState<Tipo>('tono');
  const [precio, setPrecio] = useState<number | null>(null);
  const [costo, setCosto] = useState<number | null>(null);
  const [renglones, setRenglones] = useState<RenglonNuevo[]>([renglon(), renglon()]);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (clave: string, cambios: Partial<RenglonNuevo>) =>
    setRenglones((rs) => rs.map((r) => (r.clave === clave ? { ...r, ...cambios } : r)));

  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const nombre = String(f.get('nombre') ?? '').trim();
    const categoriaId = String(f.get('categoria') ?? '');
    const variantes = renglones.filter((r) => r.variante.trim());
    if (!nombre) return setError('Poné el nombre del producto.');
    if (precio === null) return setError('Poné el precio.');
    if (!variantes.length)
      return setError(`Cargá al menos un ${TIPOS[tipo].nombre.toLowerCase()}.`);
    setEnviando(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('POST', '/api/v1/grupos-variantes', {
        nombre,
        tipo,
        precio,
        ...(costo !== null ? { costo } : {}),
        ...(categoriaId ? { categoriaId } : {}),
        variantes: variantes.map((v) => ({
          variante: v.variante.trim(),
          ...(tipo === 'tono' ? { color: v.color } : {}),
          ...(v.codigo.trim() ? { codigo: v.codigo.trim() } : {}),
          ...(Number(v.stock.replace(',', '.')) > 0
            ? { stockInicial: Number(v.stock.replace(',', '.')) }
            : {}),
        })),
      });
      await refrescarCatalogo().catch(() => undefined);
      navegar(`/stock/variantes/${r.id}`);
    } catch (e) {
      setError(mensajeDeError(e));
      setEnviando(false);
    }
  }

  const t = TIPOS[tipo];
  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/stock/variantes')} />
      <h1 className="m-titulo">Nuevo producto con {t.plural}</h1>
      <form className="formulario" onSubmit={enviar}>
        <Campo
          etiqueta="Nombre del producto"
          name="nombre"
          maxLength={100}
          placeholder="Esmalte cremoso"
          required
          autoComplete="off"
        />
        <div className="campo">
          <label htmlFor="tipo-variante">¿Qué cambia entre uno y otro?</label>
          <select
            id="tipo-variante"
            className="campo__entrada"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Tipo)}
          >
            {Object.entries(TIPOS).map(([id, x]) => (
              <option key={id} value={id}>
                {x.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="dos-columnas">
          <CampoPlata etiqueta="Precio de cada uno" valor={precio} alCambiar={setPrecio} />
          <CampoPlata etiqueta="Costo (opcional)" valor={costo} alCambiar={setCosto} />
        </div>
        <div className="campo">
          <label htmlFor="categoria-variantes">Categoría</label>
          <select id="categoria-variantes" name="categoria" className="campo__entrada">
            <option value="">Sin categoría</option>
            {catalogo?.categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="campo renglones-variantes">
          <legend>{t.nombre[0]?.toUpperCase() + t.plural.slice(1)}</legend>
          {renglones.map((r, i) => (
            <div key={r.clave} className="renglon-variante">
              <Campo
                etiqueta={`${t.nombre} ${i + 1}`}
                value={r.variante}
                maxLength={60}
                placeholder={t.ejemplo}
                autoComplete="off"
                onChange={(e) => cambiar(r.clave, { variante: e.target.value })}
              />
              {tipo === 'tono' && (
                <div className="campo campo--color">
                  <label htmlFor={`color-${r.clave}`}>Color</label>
                  <input
                    id={`color-${r.clave}`}
                    type="color"
                    className="campo__color"
                    value={r.color}
                    onChange={(e) => cambiar(r.clave, { color: e.target.value })}
                  />
                </div>
              )}
              <Campo
                etiqueta="Código (opcional)"
                value={r.codigo}
                maxLength={48}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => cambiar(r.clave, { codigo: e.target.value })}
              />
              <Campo
                etiqueta="Stock"
                value={r.stock}
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => cambiar(r.clave, { stock: e.target.value })}
              />
            </div>
          ))}
          <button
            type="button"
            className="m-boton"
            disabled={renglones.length >= 60}
            onClick={() => setRenglones((rs) => [...rs, renglon()])}
          >
            Agregar otro {t.nombre.toLowerCase()}
          </button>
        </fieldset>
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton m-boton--principal" disabled={enviando}>
          Guardar
        </button>
      </form>
    </div>
  );
}

interface Detalle {
  id: string;
  nombre: string;
  tipo: Tipo;
  variantes: {
    id: string;
    variante: string;
    color: string | null;
    precio: number;
    stock: number;
    activo: boolean;
    codigos: string[];
  }[];
}

/** Un producto con sus variantes: stock de cada una y alta de una más. */
export function GrupoVariantesPantalla({ id }: { id: string }) {
  const s = useSesionCompleta();
  const editar = puede.editarCatalogo(s.rol);
  const { datos, error, recargar } = useDatos<Detalle>(`/api/v1/grupos-variantes/${id}`);
  const [color, setColor] = useState('#c0182b');
  const [errorAlta, setErrorAlta] = useState<string | null>(null);

  async function agregar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const variante = String(f.get('variante') ?? '').trim();
    const codigo = String(f.get('codigo') ?? '').trim();
    const stock = Number(String(f.get('stock') ?? '').replace(',', '.'));
    if (!variante) return;
    setErrorAlta(null);
    try {
      await api('POST', `/api/v1/grupos-variantes/${id}/variantes`, {
        variante,
        ...(datos?.tipo === 'tono' ? { color } : {}),
        ...(codigo ? { codigo } : {}),
        ...(stock > 0 ? { stockInicial: stock } : {}),
      });
      form.reset();
      await recargar();
      await refrescarCatalogo().catch(() => undefined);
    } catch (e) {
      setErrorAlta(mensajeDeError(e));
    }
  }

  if (error) return <Aviso>{error}</Aviso>;
  if (!datos) return <div className="pantalla" aria-busy="true" />;
  const t = TIPOS[datos.tipo];
  const activas = datos.variantes.filter((v) => v.activo);
  return (
    <div className="pantalla pantalla--ancha">
      <Volver onClick={() => navegar('/stock/variantes')} />
      <h1 className="m-titulo">{datos.nombre}</h1>
      <p className="texto-suave">
        {activas.length} {activas.length === 1 ? t.nombre.toLowerCase() : t.plural} · Quedan{' '}
        {formatearCantidad(activas.reduce((x, v) => x + v.stock, 0))} en total
      </p>
      <ul className="lista-filas">
        {activas.map((v) => (
          <li key={v.id}>
            <button
              type="button"
              className="fila fila--variante"
              onClick={() => navegar(`/stock/producto/${v.id}`)}
            >
              <span
                className={`variante__muestra${v.color ? '' : ' variante__muestra--sin-color'}`}
                style={v.color ? { background: v.color } : undefined}
                aria-hidden="true"
              />
              <span className="fila__texto">
                <span className="fila__titulo">{v.variante}</span>
                <span className="texto-suave">
                  {v.codigos.length ? v.codigos.join(', ') : 'Sin código'}
                </span>
              </span>
              <span className="fila__derecha">
                <span className="m-plata">{formatearPlata(v.precio)}</span>
                <span className={v.stock <= 0 ? 'texto-alerta' : 'texto-suave'}>
                  {v.stock > 0 ? `Quedan ${formatearCantidad(v.stock)}` : 'Sin stock'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {editar && (
        <form className="formulario tarjeta-form" onSubmit={agregar}>
          <h2 className="subtitulo">Agregar un {t.nombre.toLowerCase()}</h2>
          <div className="renglon-variante">
            <Campo
              etiqueta={t.nombre}
              name="variante"
              maxLength={60}
              placeholder={t.ejemplo}
              required
              autoComplete="off"
            />
            {datos.tipo === 'tono' && (
              <div className="campo campo--color">
                <label htmlFor="color-nuevo">Color</label>
                <input
                  id="color-nuevo"
                  type="color"
                  className="campo__color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
            )}
            <Campo etiqueta="Código (opcional)" name="codigo" maxLength={48} autoComplete="off" />
            <Campo etiqueta="Stock" name="stock" inputMode="decimal" autoComplete="off" />
          </div>
          {errorAlta && <Aviso>{errorAlta}</Aviso>}
          <button className="m-boton">Agregar</button>
        </form>
      )}
    </div>
  );
}
