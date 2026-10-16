import {
  DATOS_UNIDADES,
  UNIDADES,
  diaArgentino,
  diaCorto,
  formatearCantidad,
  formatearPlata,
  type Unidad,
} from '@mostrador/shared';
import { useState, type FormEvent } from 'react';
import { CampoPlata } from '../../componentes/CampoPlata.tsx';
import { Escaner } from '../../componentes/Escaner.tsx';
import { Aviso, Campo, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { productoPorId, refrescarCatalogo, useCatalogo } from '../../nucleo/catalogo.ts';
import { useEsPC } from '../../nucleo/medios.ts';
import { sumarProducto } from '../../nucleo/ticket.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface Detalle {
  id: string;
  nombre: string;
  precio: number;
  costo?: number | null;
  categoriaId: string | null;
  stock: number;
  minimo: number;
  activo: boolean;
  codigos: string[];
  unidad?: Unidad;
  ubicacion?: string | null;
  precioGremio?: number | null;
  proveedores?: { proveedorId: string; nombre: string; codigo: string; costo?: number | null }[];
  grupo?: { id: string; nombre: string; tipo: string } | null;
  variante?: string | null;
  color?: string | null;
  lotes?: { id: string; venceEn: string; cantidad: number }[];
  movimientos: {
    id: string;
    tipo: string;
    cantidad: number;
    motivo: string | null;
    created_at: string;
    nombre: string | null;
  }[];
}

const TIPOS: Record<string, string> = {
  venta: 'Venta',
  compra: 'Compra',
  ajuste: 'Ajuste',
  anulacion: 'Anulación',
  devolucion: 'Cambio (volvió)',
};

export function ProductoPantalla({
  id,
  codigoInicial,
}: {
  id: string | null;
  codigoInicial?: string | null;
}) {
  const { datos, recargar } = useDatos<Detalle>(id ? `/api/v1/productos/${id}` : null);
  if (id && !datos) return <div className="pantalla" aria-busy="true" />;
  return (
    <FormProducto
      key={datos?.id ?? 'nuevo'}
      detalle={datos}
      codigoInicial={codigoInicial ?? null}
      recargar={recargar}
    />
  );
}

function FormProducto({
  detalle,
  codigoInicial,
  recargar,
}: {
  detalle: Detalle | null;
  codigoInicial: string | null;
  recargar: () => Promise<void>;
}) {
  const { catalogo } = useCatalogo();
  const negocio = useNegocio();
  const conUnidades = negocio.tiene('venta_fraccionada');
  const conGremio = negocio.tiene('listas_precios');
  const conUbicacion = negocio.tiene('ubicaciones');
  const conProveedores = negocio.tiene('precios_proveedor');
  const { datos: proveedores } = useDatos<{ id: string; nombre: string }[]>(
    conProveedores ? '/api/v1/proveedores' : null,
  );
  const [codigosProveedor, setCodigosProveedor] = useState<Record<string, string>>(() =>
    Object.fromEntries((detalle?.proveedores ?? []).map((p) => [p.proveedorId, p.codigo])),
  );
  const [precio, setPrecio] = useState<number | null>(detalle?.precio ?? null);
  const [precioGremio, setPrecioGremio] = useState<number | null>(detalle?.precioGremio ?? null);
  const [unidad, setUnidad] = useState<Unidad>(detalle?.unidad ?? 'unidad');
  const [costo, setCosto] = useState<number | null>(detalle?.costo ?? null);
  const [codigos, setCodigos] = useState<string[]>(
    detalle?.codigos ?? (codigoInicial ? [codigoInicial] : []),
  );
  const [codigoNuevo, setCodigoNuevo] = useState('');
  const [categoria, setCategoria] = useState(detalle?.categoriaId ?? '');
  const grupo = detalle?.grupo ?? null;
  const [color, setColor] = useState(detalle?.color ?? '#c0182b');
  const [error, setError] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState(false);
  const [escaner, setEscaner] = useState(false);
  const esPC = useEsPC();
  // Desde Vender (código desconocido): al guardar se vuelve a la venta con el producto sumado.
  const desdeVender = new URLSearchParams(location.search).get('volver') === 'vender';
  const volver = () => navegar(desdeVender ? '/' : '/stock');

  async function guardar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    if (precio === null) {
      setError('Poné el precio de venta.');
      return;
    }
    const extra = codigoNuevo.trim() ? [codigoNuevo.trim()] : [];
    const cuerpo = {
      // El nombre de una variante sale del grupo y del tono.
      ...(grupo
        ? {
            variante: String(f.get('variante') ?? '').trim(),
            ...(grupo.tipo === 'tono' ? { color } : {}),
          }
        : { nombre: String(f.get('nombre') ?? '') }),
      precio,
      costo,
      categoriaId: categoria || null,
      minimo: Number(String(f.get('minimo') ?? '0').replace(',', '.')) || 0,
      codigos: [...new Set([...codigos, ...extra])],
      ...(conUnidades ? { unidad } : {}),
      ...(conGremio ? { precioGremio } : {}),
      ...(conUbicacion ? { ubicacion: String(f.get('ubicacion') ?? '').trim() || null } : {}),
      ...(conProveedores && proveedores
        ? {
            proveedores: Object.entries(codigosProveedor)
              .map(([proveedorId, codigo]) => ({ proveedorId, codigo: codigo.trim() }))
              .filter((p) => p.codigo),
          }
        : {}),
      ...(detalle
        ? {}
        : { stockInicial: Number(String(f.get('stock') ?? '0').replace(',', '.')) || 0 }),
    };
    try {
      let creado: string | null = null;
      if (detalle) await api('PATCH', `/api/v1/productos/${detalle.id}`, cuerpo);
      else creado = (await api<{ id: string }>('POST', '/api/v1/productos', cuerpo)).id;
      await refrescarCatalogo();
      const nuevo = creado ? productoPorId(creado) : undefined;
      if (desdeVender && nuevo && (!nuevo.unidad || nuevo.unidad === 'unidad'))
        sumarProducto(nuevo);
      volver();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function nuevaCategoria() {
    const nombre = prompt('Nombre de la categoría nueva');
    if (!nombre) return;
    try {
      const r = await api<{ id: string }>('POST', '/api/v1/categorias', { nombre });
      await refrescarCatalogo();
      setCategoria(r.id);
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function archivar() {
    if (
      !detalle ||
      !confirm(`¿Sacar "${detalle.nombre}" del catálogo? Las ventas viejas no se tocan.`)
    )
      return;
    await api('PATCH', `/api/v1/productos/${detalle.id}`, { activo: false });
    await refrescarCatalogo();
    volver();
  }

  return (
    <div className="pantalla">
      <Volver onClick={volver} />
      <h1 className="m-titulo">{detalle ? 'Editar producto' : 'Nuevo producto'}</h1>
      <form className="formulario" onSubmit={guardar}>
        {grupo ? (
          <>
            <p className="texto-suave">
              Es una variante de{' '}
              <button
                type="button"
                className="enlace-boton"
                onClick={() => navegar(`/stock/variantes/${grupo.id}`)}
              >
                {grupo.nombre}
              </button>
              .
            </p>
            <div className="renglon-variante">
              <Campo
                etiqueta={grupo.tipo === 'tono' ? 'Tono' : 'Variante'}
                name="variante"
                defaultValue={detalle?.variante ?? ''}
                required
                maxLength={60}
              />
              {grupo.tipo === 'tono' && (
                <div className="campo campo--color">
                  <label htmlFor="color-producto">Color</label>
                  <input
                    id="color-producto"
                    type="color"
                    className="campo__color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                  />
                </div>
              )}
            </div>
          </>
        ) : (
          <Campo
            etiqueta="Nombre"
            name="nombre"
            defaultValue={detalle?.nombre ?? ''}
            required
            maxLength={120}
          />
        )}
        {conUnidades && (
          <div className="campo">
            <label htmlFor="unidad">Se vende por</label>
            <select
              id="unidad"
              className="campo__entrada"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value as Unidad)}
            >
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {DATOS_UNIDADES[u].nombre}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="dos-columnas">
          <CampoPlata
            etiqueta={
              unidad === 'unidad'
                ? 'Precio de venta'
                : `Precio de venta (${DATOS_UNIDADES[unidad].precioPor})`
            }
            valor={precio}
            alCambiar={setPrecio}
            required
          />
          <CampoPlata etiqueta="Costo (opcional)" valor={costo} alCambiar={setCosto} />
        </div>
        {conGremio && (
          <CampoPlata
            etiqueta="Precio de gremio (opcional)"
            valor={precioGremio}
            alCambiar={setPrecioGremio}
            ayuda="Si lo dejás vacío, al gremio se le cobra el de mostrador."
          />
        )}
        {precio !== null && costo !== null && costo > 0 && (
          <p className="texto-suave">
            Margen: {Math.round(((precio - costo) / costo) * 100)} % sobre el costo.
          </p>
        )}
        {conUbicacion && (
          <Campo
            etiqueta="Dónde está (opcional)"
            name="ubicacion"
            maxLength={40}
            defaultValue={detalle?.ubicacion ?? ''}
            placeholder="Por ejemplo, Pasillo 3 · Estante B"
          />
        )}
        <div className="campo">
          <label htmlFor="categoria">Categoría</label>
          <div className="fila-control">
            <select
              id="categoria"
              className="campo__entrada"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              <option value="">Sin categoría</option>
              {catalogo?.categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <button type="button" className="m-boton" onClick={nuevaCategoria}>
              Nueva
            </button>
          </div>
        </div>
        <div className="dos-columnas">
          <Campo
            etiqueta="Stock mínimo"
            name="minimo"
            inputMode="decimal"
            defaultValue={String(detalle?.minimo ?? 0)}
            ayuda="Por debajo de esto aparece en Por reponer."
          />
          {!detalle && (
            <Campo etiqueta="Stock actual" name="stock" inputMode="decimal" defaultValue="0" />
          )}
        </div>
        {conProveedores && proveedores && proveedores.length > 0 && (
          <fieldset className="campo">
            <legend>Código en la lista de cada proveedor (opcional)</legend>
            <div className="dos-columnas">
              {proveedores.map((p) => (
                <Campo
                  key={p.id}
                  etiqueta={p.nombre}
                  maxLength={60}
                  value={codigosProveedor[p.id] ?? ''}
                  onChange={(e) =>
                    setCodigosProveedor({ ...codigosProveedor, [p.id]: e.target.value })
                  }
                />
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="campo">
          <legend>Códigos de barras</legend>
          <ul className="codigos-producto">
            {codigos.map((c) => (
              <li key={c}>
                <code>{c}</code>
                <button
                  type="button"
                  className="enlace-boton"
                  onClick={() => setCodigos(codigos.filter((x) => x !== c))}
                  aria-label={`Quitar código ${c}`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          <div className="fila-control">
            <label className="m-solo-lectores" htmlFor="codigo-nuevo">
              Código nuevo
            </label>
            <input
              id="codigo-nuevo"
              className="campo__entrada"
              placeholder="Escaneá o escribí el código"
              value={codigoNuevo}
              onChange={(e) => setCodigoNuevo(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (codigoNuevo) setCodigos([...new Set([...codigos, codigoNuevo])]);
                  setCodigoNuevo('');
                }
              }}
            />
            <button
              type="button"
              className="m-boton"
              onClick={() => {
                if (codigoNuevo) setCodigos([...new Set([...codigos, codigoNuevo])]);
                setCodigoNuevo('');
              }}
            >
              Agregar
            </button>
            {!esPC && (
              <button type="button" className="m-boton" onClick={() => setEscaner(true)}>
                Escanear
              </button>
            )}
          </div>
          {escaner && (
            <Escaner
              ayuda="Apuntá al código de barras del producto."
              alLeer={(codigo) => {
                setCodigos((cs) => [...new Set([...cs, codigo])]);
                setEscaner(false);
              }}
              alCerrar={() => setEscaner(false)}
            />
          )}
        </fieldset>
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton m-boton--principal">Guardar</button>
      </form>

      {detalle && (
        <>
          <section className="tarjeta-form">
            <h2 className="subtitulo">Stock: {formatearCantidad(detalle.stock, detalle.unidad)}</h2>
            {ajuste ? (
              <AjusteStock
                id={detalle.id}
                alTerminar={async () => {
                  setAjuste(false);
                  await recargar();
                }}
              />
            ) : (
              <button type="button" className="m-boton" onClick={() => setAjuste(true)}>
                Ajustar stock
              </button>
            )}
            <ul className="lista-movimientos">
              {detalle.movimientos.map((m) => (
                <li key={m.id}>
                  <span>
                    {TIPOS[m.tipo]}
                    {m.motivo ? ` · ${m.motivo}` : ''}
                  </span>
                  <span className={`m-plata ${m.cantidad < 0 ? 'negativo' : ''}`}>
                    {m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}
                  </span>
                  <span className="texto-suave">
                    {new Date(m.created_at).toLocaleString('es-AR')} · {m.nombre ?? ''}
                  </span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="enlace-boton"
              onClick={() => navegar(`/stock/movimientos?producto=${detalle.id}`)}
            >
              Ver todos los movimientos
            </button>
          </section>
          {negocio.tiene('vencimientos') && (
            <Lotes id={detalle.id} lotes={detalle.lotes ?? []} recargar={recargar} />
          )}
          <p className="texto-suave">Precio actual: {formatearPlata(detalle.precio)}</p>
          <button type="button" className="m-boton m-boton--peligro" onClick={archivar}>
            Sacar del catálogo
          </button>
        </>
      )}
    </div>
  );
}

/** Lotes con fecha de vencimiento del producto (etapa I7). */
function Lotes({
  id,
  lotes,
  recargar,
}: {
  id: string;
  lotes: { id: string; venceEn: string; cantidad: number }[];
  recargar: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const hoy = diaArgentino();

  async function agregar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const venceEn = String(f.get('vence') ?? '');
    const cantidad = Number(String(f.get('cantidad') ?? '').replace(',', '.'));
    if (!venceEn || !(cantidad > 0)) {
      setError('Poné la fecha de vencimiento y cuántas unidades entraron.');
      return;
    }
    setError(null);
    try {
      await api('POST', '/api/v1/lotes', { productoId: id, venceEn, cantidad });
      form.reset();
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  async function retirar(lote: string) {
    try {
      await api('POST', `/api/v1/lotes/${lote}/retirar`, {});
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  return (
    <section className="tarjeta-form" aria-labelledby="titulo-lotes">
      <h2 id="titulo-lotes" className="subtitulo">
        Vencimientos
      </h2>
      {lotes.length === 0 ? (
        <p className="texto-suave">Sin lotes cargados.</p>
      ) : (
        <ul className="lista-filas">
          {lotes.map((l) => (
            <li key={l.id} className="fila">
              <span className="fila__texto">
                <span className={l.venceEn < hoy ? 'texto-alerta' : 'fila__titulo'}>
                  {l.venceEn < hoy ? 'Venció' : 'Vence'} el {diaCorto(l.venceEn)}
                </span>
                <span className="texto-suave">Entraron {formatearCantidad(l.cantidad)}</span>
              </span>
              <button type="button" className="m-boton" onClick={() => void retirar(l.id)}>
                Ya no queda
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="formulario" onSubmit={agregar}>
        <div className="dos-columnas">
          <Campo etiqueta="Vence el" name="vence" type="date" required />
          <Campo etiqueta="Cuántos entraron" name="cantidad" inputMode="decimal" required />
        </div>
        {error && <Aviso>{error}</Aviso>}
        <button className="m-boton">Agregar lote</button>
      </form>
    </section>
  );
}

function AjusteStock({ id, alTerminar }: { id: string; alTerminar: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  async function enviar(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const motivo = String(f.get('motivo'));
    const valor = Number(String(f.get('valor') ?? '').replace(',', '.'));
    if (!Number.isFinite(valor)) {
      setError('Poné un número.');
      return;
    }
    try {
      await api('POST', '/api/v1/stock/ajustes', {
        productoId: id,
        motivo,
        ...(motivo === 'conteo' ? { contado: valor } : { cantidad: -Math.abs(valor) }),
        nota: String(f.get('nota') ?? '') || undefined,
      });
      await refrescarCatalogo();
      await alTerminar();
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }
  return (
    <form className="formulario" onSubmit={enviar}>
      <div className="campo">
        <label htmlFor="motivo">Motivo</label>
        <select id="motivo" name="motivo" className="campo__entrada" defaultValue="conteo">
          <option value="conteo">Conté el estante (pongo lo que hay)</option>
          <option value="rotura">Se rompió (resto)</option>
          <option value="vencido">Se venció (resto)</option>
          <option value="robo">Faltante (resto)</option>
          <option value="otro">Otro (resto)</option>
        </select>
      </div>
      <Campo etiqueta="Cantidad" name="valor" inputMode="decimal" required />
      <Campo etiqueta="Nota (opcional)" name="nota" maxLength={150} />
      {error && <Aviso>{error}</Aviso>}
      <button className="m-boton">Guardar ajuste</button>
    </form>
  );
}
