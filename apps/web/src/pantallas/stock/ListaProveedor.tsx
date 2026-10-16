import {
  detectarColumnas,
  ErrorPlanilla,
  formatearPlata,
  leerCsv,
  leerXlsx,
  renglonesDeLista,
  type Columnas,
} from '@mostrador/shared';
import { useMemo, useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { api, mensajeDeError } from '../../nucleo/api.ts';
import { buscarProductos, refrescarCatalogo, productoPorId } from '../../nucleo/catalogo.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';
import { Etiquetas, imprimirEtiquetas, type Etiqueta } from './Etiquetas.tsx';
import type { Proveedor } from './Proveedores.tsx';

interface Cambio {
  productoId: string;
  nombre: string;
  codigo: string;
  vinculo: 'proveedor' | 'barras' | 'manual';
  costoAntes: number | null;
  costo: number;
  precioAntes: number;
  precio: number;
  gremioAntes: number | null;
  gremio: number | null;
  variacion: number | null;
  grande: boolean;
}

interface Nuevo {
  codigo: string;
  descripcion: string;
  costo: number;
  precio: number;
}

interface Vista {
  resumen: {
    renglones: number;
    encontrados: number;
    suben: number;
    bajan: number;
    cambian: number;
    nuevos: number;
    repetidos: number;
    grandes: number;
  };
  cambios: Cambio[];
  nuevos: Nuevo[];
}

interface ListaAnterior {
  deshecha_en: string | null;
  opciones: {
    descuento: number;
    iva: boolean;
    calculo: 'mantener' | 'ganancia';
    ganancia: number;
    redondeo: 100 | 1000 | 5000 | 10000;
    gremio: 'no' | 'mantener' | 'ganancia';
    gananciaGremio: number;
    columnas?: Columnas;
  };
}

interface Archivo {
  nombre: string;
  filas: string[][];
  origen: 'xlsx' | 'csv';
}

const REDONDEOS = [
  { valor: 100, texto: '$ 1' },
  { valor: 1000, texto: '$ 10' },
  { valor: 5000, texto: '$ 50' },
  { valor: 10000, texto: '$ 100' },
] as const;

const MAX_FILAS_VISTA = 300;

const numero = (t: string) => {
  const n = Number(t.replace(',', '.').trim() || '0');
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

const cambia = (c: Cambio) =>
  c.costo !== c.costoAntes || c.precio !== c.precioAntes || c.gremio !== c.gremioAntes;

function Antes({ antes, ahora }: { antes: number | null; ahora: number | null }) {
  if (ahora === null) return <span className="texto-suave">—</span>;
  if (antes === ahora || antes === null) return <span>{formatearPlata(ahora)}</span>;
  return (
    <span>
      <s className="texto-suave">{formatearPlata(antes)}</s> {formatearPlata(ahora)}
    </span>
  );
}

/** Actualizar precios con la lista que mandó un proveedor (etapa I3). */
export function ListaProveedor({ id }: { id: string }) {
  const negocio = useNegocio();
  const conGremio = negocio.tiene('listas_precios');
  const { datos: proveedores } = useDatos<Proveedor[]>('/api/v1/proveedores');
  const proveedor = proveedores?.find((p) => p.id === id);
  // La última lista de este proveedor: se reusan su formato y sus números.
  const { datos: anteriores } = useDatos<ListaAnterior[]>(`/api/v1/proveedores/${id}/listas`);
  const anterior = anteriores?.find((l) => !l.deshecha_en)?.opciones ?? null;
  /** Las columnas de la lista anterior, si la planilla nueva tiene esa forma. */
  const columnasGuardadas = (filas: string[][]) => {
    const g = anterior?.columnas;
    return g && (filas[g.encabezado]?.length ?? 0) > Math.max(g.codigo, g.precio) ? g : null;
  };

  const [archivo, setArchivo] = useState<Archivo | null>(null);
  const [columnas, setColumnas] = useState<Columnas | null>(null);
  const [descuento, setDescuento] = useState('0');
  const [iva, setIva] = useState(false);
  const [calculo, setCalculo] = useState<'mantener' | 'ganancia'>('mantener');
  const [ganancia, setGanancia] = useState('40');
  const [redondeo, setRedondeo] = useState<100 | 1000 | 5000 | 10000>(5000);
  const [gremio, setGremio] = useState<'no' | 'mantener' | 'ganancia'>(
    conGremio ? 'mantener' : 'no',
  );
  const [gananciaGremio, setGananciaGremio] = useState('25');
  const [vincular, setVincular] = useState<Record<string, string>>({});
  const [crear, setCrear] = useState<Set<string>>(new Set());
  const [vista, setVista] = useState<Vista | null>(null);
  const [soloCambios, setSoloCambios] = useState(true);
  const [buscando, setBuscando] = useState<{ codigo: string; q: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [hecho, setHecho] = useState<{ id: string; cambiados: number; creados: number } | null>(
    null,
  );
  const [deshecho, setDeshecho] = useState<string | null>(null);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [recordado, setRecordado] = useState(false);

  // Una vez, cuando llega la última lista: mismos números que la vez pasada.
  if (anterior && !recordado) {
    setRecordado(true);
    setDescuento(String(anterior.descuento).replace('.', ','));
    setIva(anterior.iva);
    setCalculo(anterior.calculo);
    setGanancia(String(anterior.ganancia).replace('.', ','));
    setRedondeo(anterior.redondeo);
    if (conGremio) {
      setGremio(anterior.gremio);
      setGananciaGremio(String(anterior.gananciaGremio).replace('.', ','));
    }
    // Si el archivo se eligió antes de que llegara la lista anterior.
    const g = archivo ? columnasGuardadas(archivo.filas) : null;
    if (g) setColumnas(g);
  }

  const lectura = useMemo(
    () => (archivo && columnas ? renglonesDeLista(archivo.filas, columnas, archivo.origen) : null),
    [archivo, columnas],
  );

  const opciones = () => {
    const o = {
      descuento: numero(descuento),
      iva,
      calculo,
      ganancia: numero(ganancia),
      redondeo,
      gremio,
      gananciaGremio: numero(gananciaGremio),
      ...(columnas ? { columnas } : {}),
    };
    if ([o.descuento, o.ganancia, o.gananciaGremio].some((n) => Number.isNaN(n)))
      throw new Error('Revisá los porcentajes: tienen que ser números.');
    return o;
  };

  async function elegir(f: File) {
    setError(null);
    setVista(null);
    setHecho(null);
    setVincular({});
    setCrear(new Set());
    if (f.size > 10_000_000) {
      setError('El archivo es muy grande (máximo 10 MB).');
      return;
    }
    try {
      const esXlsx = /\.xlsx$/i.test(f.name);
      if (/\.xls$/i.test(f.name)) {
        setError('Ese es un Excel viejo (.xls). Abrilo y guardalo como .xlsx o .csv.');
        return;
      }
      const filas = esXlsx
        ? await leerXlsx(new Uint8Array(await f.arrayBuffer()))
        : leerCsv(await f.text());
      setArchivo({ nombre: f.name.slice(0, 120), filas, origen: esXlsx ? 'xlsx' : 'csv' });
      // Primero, las columnas de la lista anterior de este proveedor, si la planilla tiene esa
      // forma; si no, se buscan por los títulos.
      const detectadas = columnasGuardadas(filas) ?? detectarColumnas(filas);
      setColumnas(detectadas ?? { encabezado: 0, codigo: 0, descripcion: 1, precio: 2 });
      if (!detectadas)
        setError('No encontramos solas las columnas de código y precio. Elegilas abajo.');
    } catch (e) {
      setArchivo(null);
      setError(e instanceof ErrorPlanilla ? e.message : 'No pudimos leer ese archivo.');
    }
  }

  async function verCambios(conVincular = vincular) {
    if (!lectura?.renglones.length) {
      setError('La lista no tiene renglones con código y precio.');
      return;
    }
    setError(null);
    setOcupado(true);
    try {
      setVista(
        await api<Vista>('POST', `/api/v1/proveedores/${id}/lista/vista-previa`, {
          renglones: lectura.renglones,
          opciones: opciones(),
          vincular: Object.entries(conVincular).map(([codigo, productoId]) => ({
            codigo,
            productoId,
          })),
        }),
      );
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  async function aplicar() {
    if (!vista || !lectura) return;
    const n = vista.resumen.cambian + crear.size;
    if (
      !confirm(
        `¿Aplicar la lista? Se cambian ${n} productos. Queda registrado y se puede deshacer.`,
      )
    )
      return;
    setError(null);
    setOcupado(true);
    try {
      const r = await api<{ id: string; cambiados: number; creados: number }>(
        'POST',
        `/api/v1/proveedores/${id}/lista/aplicar`,
        {
          archivo: archivo?.nombre,
          renglones: lectura.renglones,
          opciones: opciones(),
          vincular: Object.entries(vincular).map(([codigo, productoId]) => ({
            codigo,
            productoId,
          })),
          crear: [...crear],
        },
      );
      setHecho(r);
      await refrescarCatalogo();
      setEtiquetas([
        ...vista.cambios
          .filter((c) => c.precio !== c.precioAntes)
          .map((c) => ({
            nombre: c.nombre,
            precio: c.precio,
            unidad: productoPorId(c.productoId)?.unidad,
            codigo: c.codigo,
          })),
        ...vista.nuevos
          .filter((x) => crear.has(x.codigo))
          .map((x) => ({ nombre: x.descripcion || x.codigo, precio: x.precio, codigo: x.codigo })),
      ]);
    } catch (e) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(false);
    }
  }

  async function deshacer() {
    if (!hecho || !confirm('¿Volver a los precios de antes de esta lista?')) return;
    try {
      const r = await api<{ restaurados: number; saltados: number }>(
        'POST',
        `/api/v1/listas-proveedor/${hecho.id}/deshacer`,
        {},
      );
      await refrescarCatalogo();
      setDeshecho(
        r.saltados
          ? `Volvieron ${r.restaurados} precios. ${r.saltados} no se tocaron porque los cambiaste después.`
          : `Volvieron los ${r.restaurados} precios de antes.`,
      );
    } catch (e) {
      setError(mensajeDeError(e));
    }
  }

  const encabezado = archivo && columnas ? (archivo.filas[columnas.encabezado] ?? []) : [];
  const nombreColumna = (i: number) => encabezado[i] || `Columna ${i + 1}`;
  const visibles = (vista?.cambios ?? []).filter((c) => !soloCambios || cambia(c));

  if (hecho) {
    return (
      <div className="pantalla">
        <Volver onClick={() => navegar('/compras/proveedores')} />
        <h1 className="m-titulo">Lista aplicada</h1>
        <Aviso tipo="ok">
          {hecho.cambiados === 1 ? 'Cambió 1 producto' : `Cambiaron ${hecho.cambiados} productos`}
          {hecho.creados === 1 && ' y se cargó 1 nuevo'}
          {hecho.creados > 1 && ` y se cargaron ${hecho.creados} nuevos`}.
        </Aviso>
        {deshecho && <Aviso tipo="info">{deshecho}</Aviso>}
        {error && <Aviso>{error}</Aviso>}
        <div className="acciones">
          {etiquetas.length > 0 && (
            <button type="button" className="m-boton m-boton--accion" onClick={imprimirEtiquetas}>
              Imprimir {etiquetas.length} etiquetas nuevas
            </button>
          )}
          {!deshecho && (
            <button type="button" className="m-boton" onClick={() => void deshacer()}>
              Deshacer
            </button>
          )}
        </div>
        <Etiquetas items={etiquetas} />
      </div>
    );
  }

  return (
    <div className="pantalla pantalla--ancha lista-proveedor">
      <Volver onClick={() => navegar('/compras/proveedores')} />
      <h1 className="m-titulo">Lista nueva{proveedor ? ` de ${proveedor.nombre}` : ''}</h1>

      <section className="tarjeta-form formulario" aria-labelledby="paso-archivo">
        <h2 className="subtitulo" id="paso-archivo">
          1. La lista
        </h2>
        <label className="m-boton subir-archivo">
          {archivo ? `Cambiar archivo (${archivo.nombre})` : 'Elegir la lista (Excel .xlsx o .csv)'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.txt,text/csv"
            className="m-solo-lectores"
            onChange={(e) => e.target.files?.[0] && void elegir(e.target.files[0])}
          />
        </label>
        {archivo && columnas && (
          <>
            <div className="columnas-lista">
              {(
                [
                  ['codigo', 'Código'],
                  ['descripcion', 'Descripción'],
                  ['precio', 'Precio'],
                ] as const
              ).map(([clave, etiqueta]) => (
                <div className="campo" key={clave}>
                  <label htmlFor={`col-${clave}`}>{etiqueta}</label>
                  <select
                    id={`col-${clave}`}
                    className="campo__entrada"
                    value={columnas[clave]}
                    onChange={(e) => {
                      setColumnas({ ...columnas, [clave]: Number(e.target.value) });
                      setVista(null);
                    }}
                  >
                    {clave === 'descripcion' && <option value={-1}>(ninguna)</option>}
                    {Array.from({ length: Math.max(encabezado.length, 1) }, (_, i) => (
                      <option key={i} value={i}>
                        {nombreColumna(i)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="campo">
                <label htmlFor="col-encabezado">Títulos en la fila</label>
                <select
                  id="col-encabezado"
                  className="campo__entrada"
                  value={columnas.encabezado}
                  onChange={(e) => {
                    setColumnas({ ...columnas, encabezado: Number(e.target.value) });
                    setVista(null);
                  }}
                >
                  {archivo.filas.slice(0, 30).map((_, i) => (
                    <option key={i} value={i}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {lectura && (
              <p className="texto-suave">
                {lectura.renglones.length} renglones con código y precio
                {lectura.descartados > 0 && ` · ${lectura.descartados} sin código o sin precio`}.
              </p>
            )}
          </>
        )}
      </section>

      {archivo && (
        <section className="tarjeta-form formulario" aria-labelledby="paso-calculo">
          <h2 className="subtitulo" id="paso-calculo">
            2. Cómo calcular
          </h2>
          <div className="opciones-lista">
            <div className="campo">
              <label htmlFor="descuento">Bonificación del proveedor (%)</label>
              <input
                id="descuento"
                className="campo__entrada"
                inputMode="decimal"
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
              />
            </div>
            <label className="opcion opcion--check">
              <input type="checkbox" checked={iva} onChange={(e) => setIva(e.target.checked)} />
              La lista viene sin IVA: sumar 21 %
            </label>
            <fieldset className="campo opciones-lista__grupo">
              <legend>Precio de venta</legend>
              <label className="opcion">
                <input
                  type="radio"
                  name="calculo"
                  checked={calculo === 'mantener'}
                  onChange={() => setCalculo('mantener')}
                />
                Mantener la ganancia de cada producto
              </label>
              <label className="opcion">
                <input
                  type="radio"
                  name="calculo"
                  checked={calculo === 'ganancia'}
                  onChange={() => setCalculo('ganancia')}
                />
                Costo más una ganancia fija
              </label>
            </fieldset>
            <div className="campo">
              <label htmlFor="ganancia">Ganancia (%)</label>
              <input
                id="ganancia"
                className="campo__entrada"
                inputMode="decimal"
                value={ganancia}
                aria-describedby="ganancia-ayuda"
                onChange={(e) => setGanancia(e.target.value)}
              />
              <p className="campo__ayuda" id="ganancia-ayuda">
                {calculo === 'mantener'
                  ? 'Solo para productos sin costo cargado y para los nuevos.'
                  : 'Se aplica a todos los productos de la lista.'}
              </p>
            </div>
            <div className="campo">
              <label htmlFor="redondeo">Redondear a</label>
              <select
                id="redondeo"
                className="campo__entrada"
                value={redondeo}
                onChange={(e) => setRedondeo(Number(e.target.value) as typeof redondeo)}
              >
                {REDONDEOS.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.texto}
                  </option>
                ))}
              </select>
            </div>
            {conGremio && (
              <>
                <div className="campo">
                  <label htmlFor="gremio">Precio de gremio</label>
                  <select
                    id="gremio"
                    className="campo__entrada"
                    value={gremio}
                    onChange={(e) => setGremio(e.target.value as typeof gremio)}
                  >
                    <option value="mantener">Mantener la diferencia</option>
                    <option value="ganancia">Costo más una ganancia</option>
                    <option value="no">No tocarlo</option>
                  </select>
                </div>
                {gremio === 'ganancia' && (
                  <div className="campo">
                    <label htmlFor="ganancia-gremio">Ganancia de gremio (%)</label>
                    <input
                      id="ganancia-gremio"
                      className="campo__entrada"
                      inputMode="decimal"
                      value={gananciaGremio}
                      onChange={(e) => setGananciaGremio(e.target.value)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            className="m-boton m-boton--accion"
            disabled={ocupado || !lectura?.renglones.length}
            onClick={() => void verCambios()}
          >
            {vista ? 'Volver a calcular' : 'Ver los cambios'}
          </button>
        </section>
      )}

      {error && <Aviso>{error}</Aviso>}

      {vista && (
        <section className="formulario" aria-labelledby="paso-revisar">
          <h2 className="subtitulo" id="paso-revisar">
            3. Revisá y aplicá
          </h2>
          <div className="resumen-lista">
            <p>
              <strong>{vista.resumen.encontrados}</strong> encontrados
            </p>
            <p>
              <strong>{vista.resumen.suben}</strong> suben · <strong>{vista.resumen.bajan}</strong>{' '}
              bajan
            </p>
            <p>
              <strong>{vista.resumen.nuevos}</strong> que no tenés cargados
            </p>
            {vista.resumen.grandes > 0 && (
              <p className="resumen-lista__aviso">
                <strong>{vista.resumen.grandes}</strong> cambian más del 50 %: miralos
              </p>
            )}
          </div>

          <label className="opcion opcion--check">
            <input
              type="checkbox"
              checked={soloCambios}
              onChange={(e) => setSoloCambios(e.target.checked)}
            />
            Mostrar solo los que cambian
          </label>
          <div className="tabla-contenedor">
            <table className="tabla tabla--lista">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Producto</th>
                  <th scope="col" className="num">
                    Costo
                  </th>
                  <th scope="col" className="num">
                    Cambio
                  </th>
                  <th scope="col" className="num">
                    Precio
                  </th>
                  {conGremio && (
                    <th scope="col" className="num">
                      Gremio
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, MAX_FILAS_VISTA).map((c) => (
                  <tr key={c.productoId}>
                    <td className="codigo">{c.codigo}</td>
                    <td>{c.nombre}</td>
                    <td className="num">
                      <Antes antes={c.costoAntes} ahora={c.costo} />
                    </td>
                    <td className="num">
                      {c.variacion === null
                        ? 'Sin costo antes'
                        : c.variacion === 0
                          ? 'Igual'
                          : `${c.variacion > 0 ? 'Sube' : 'Baja'} ${Math.abs(c.variacion).toLocaleString('es-AR')} %`}
                      {c.grande && <span className="revisar"> · Revisar</span>}
                    </td>
                    <td className="num">
                      <strong>
                        <Antes antes={c.precioAntes} ahora={c.precio} />
                      </strong>
                    </td>
                    {conGremio && (
                      <td className="num">
                        <Antes antes={c.gremioAntes} ahora={c.gremio} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibles.length > MAX_FILAS_VISTA && (
            <p className="texto-suave">
              Y {visibles.length - MAX_FILAS_VISTA} más. Se aplican todos.
            </p>
          )}

          {vista.nuevos.length > 0 && (
            <section className="nuevos-lista" aria-labelledby="titulo-nuevos">
              <h3 className="subtitulo" id="titulo-nuevos">
                Renglones que no tenés cargados
              </h3>
              <p className="texto-suave">
                Si es un producto que ya tenés, vinculalo: la próxima lista lo encuentra sola. Si
                no, podés cargarlo como nuevo.
              </p>
              <button
                type="button"
                className="enlace-boton"
                onClick={() =>
                  setCrear(
                    crear.size === vista.nuevos.length
                      ? new Set()
                      : new Set(vista.nuevos.map((n) => n.codigo)),
                  )
                }
              >
                {crear.size === vista.nuevos.length
                  ? 'Desmarcar todos'
                  : 'Cargar todos como nuevos'}
              </button>
              <ul className="lista-nuevos">
                {vista.nuevos.slice(0, MAX_FILAS_VISTA).map((n) => (
                  <li key={n.codigo} className="nuevo-lista">
                    <label className="opcion opcion--check">
                      <input
                        type="checkbox"
                        checked={crear.has(n.codigo)}
                        onChange={() => {
                          const c = new Set(crear);
                          if (c.has(n.codigo)) c.delete(n.codigo);
                          else c.add(n.codigo);
                          setCrear(c);
                        }}
                      />
                      <span>
                        <span className="codigo">{n.codigo}</span>{' '}
                        {n.descripcion || '(sin descripción)'}
                        <span className="texto-suave">
                          {' '}
                          · costo {formatearPlata(n.costo)} · precio {formatearPlata(n.precio)}
                        </span>
                      </span>
                    </label>
                    {buscando?.codigo === n.codigo ? (
                      <div className="vincular">
                        <label className="m-solo-lectores" htmlFor={`vincular-${n.codigo}`}>
                          Buscar el producto para {n.codigo}
                        </label>
                        <input
                          id={`vincular-${n.codigo}`}
                          className="campo__entrada"
                          placeholder="Buscar el producto"
                          autoFocus
                          value={buscando.q}
                          onChange={(e) => setBuscando({ codigo: n.codigo, q: e.target.value })}
                        />
                        <ul className="resultados-vincular">
                          {buscarProductos(buscando.q, 6).map((p) => (
                            <li key={p.id}>
                              <button
                                type="button"
                                className="resultado"
                                onClick={() => {
                                  const nuevo = { ...vincular, [n.codigo]: p.id };
                                  setVincular(nuevo);
                                  setBuscando(null);
                                  void verCambios(nuevo);
                                }}
                              >
                                <span>{p.nombre}</span>
                                <span className="m-plata">{formatearPlata(p.precio)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="m-boton"
                        onClick={() => setBuscando({ codigo: n.codigo, q: n.descripcion })}
                      >
                        Es un producto que ya tengo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            className="m-boton m-boton--principal"
            disabled={ocupado || (vista.resumen.cambian === 0 && crear.size === 0)}
            onClick={() => void aplicar()}
          >
            {vista.resumen.cambian === 0 && crear.size === 0
              ? 'No cambia ningún precio'
              : `Aplicar: ${vista.resumen.cambian + crear.size} productos`}
          </button>
        </section>
      )}
    </div>
  );
}
