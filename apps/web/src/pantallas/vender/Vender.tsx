import { formatearPlata, leerCodigoBalanza } from '@mostrador/shared';
import { CartelTotal, Ticket } from '@mostrador/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buscarProductos,
  productoPorCodigo,
  useCatalogo,
  type Producto,
} from '../../nucleo/catalogo.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { useEsPC, useHayTeclado } from '../../nucleo/medios.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import {
  cambiarCantidad,
  quitarItem,
  sumarPrecioLibre,
  sumarProducto,
  totalTicket,
  unidades,
  useTicket,
  vaciarTicket,
} from '../../nucleo/ticket.ts';
import { useTurno } from '../../nucleo/turno.ts';
import type { VentaHecha } from '../../nucleo/cobrar.ts';
import { AbrirCaja } from './AbrirCaja.tsx';
import { Cobrado } from './Cobrado.tsx';
import { Cobrar, type Medio } from './Cobrar.tsx';
import { PrecioLibre } from './PrecioLibre.tsx';

type Modo =
  | { tipo: 'ticket' }
  | { tipo: 'cobrar'; medio: Medio | null }
  | { tipo: 'cobrado'; venta: VentaHecha };

/** "3*779..." suma 3 unidades. */
function separarCantidad(texto: string): { cantidad: number; resto: string } {
  const m = /^(\d{1,4})\*(.*)$/.exec(texto.trim());
  return m
    ? { cantidad: Math.max(1, Number(m[1])), resto: (m[2] ?? '').trim() }
    : { cantidad: 1, resto: texto.trim() };
}

export function Vender({ estado }: { estado: ReactNode }) {
  const s = useSesionCompleta();
  const turno = useTurno();
  const { catalogo } = useCatalogo();
  const items = useTicket();
  const esPC = useEsPC();
  const teclado = useHayTeclado();
  const enLinea = useEnLinea();
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>({ tipo: 'ticket' });
  const [precioLibre, setPrecioLibre] = useState(false);
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const [confirmarVaciar, setConfirmarVaciar] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);
  const total = totalTicket(items);

  const { cantidad, resto } = separarCantidad(q);
  const resultados = resto ? buscarProductos(resto, 8) : [];

  const mosaicos = useMemo(() => {
    if (!catalogo) return [];
    if (categoria)
      return catalogo.productos.filter((p) => p.categoriaId === categoria).slice(0, 23);
    const porId = new Map(catalogo.productos.map((p) => [p.id, p]));
    const top = catalogo.masVendidos.map((id) => porId.get(id)).filter((p): p is Producto => !!p);
    const relleno = catalogo.productos.filter((p) => !catalogo.masVendidos.includes(p.id));
    return [...top, ...relleno].slice(0, esPC ? 17 : 11);
  }, [catalogo, categoria, esPC]);

  const enfocar = () =>
    setTimeout(() => {
      if (!document.querySelector('dialog[open]')) buscador.current?.focus();
    }, 0);

  function sumar(p: Producto, n = 1) {
    sumarProducto(p, n);
    setSeleccionado(null);
    setDesconocido(null);
    setQ('');
    setActivo(0);
    pitido();
    enfocar();
  }

  /** Enter en el buscador o un código del lector. */
  function entrar(texto: string) {
    const { cantidad: n, resto: r } = separarCantidad(texto);
    if (!r) return;
    const exacto = productoPorCodigo(r);
    if (exacto) return sumar(exacto, n);
    const balanza = leerCodigoBalanza(r);
    if (balanza) {
      const p = catalogo?.productos.find((x) =>
        x.codigos.some((c) => c === balanza.codigoProducto || c.endsWith(balanza.codigoProducto)),
      );
      if (p && balanza.precio !== undefined) {
        sumarPrecioLibre(balanza.precio, p.nombre);
        setQ('');
        return enfocar();
      }
      if (p && balanza.kilos !== undefined) return sumar(p, balanza.kilos);
    }
    if (/^\d{6,}$/.test(r)) {
      setDesconocido(r);
      setQ('');
      return;
    }
    const primero = buscarProductos(r, 8)[activo];
    if (primero) sumar(primero, n);
  }

  // Lector USB (y atajos de teclado en PC).
  useEffect(() => {
    if (modo.tipo !== 'ticket') return;
    const alTeclear = (ev: KeyboardEvent) => {
      const enOtroCampo =
        ev.target instanceof HTMLElement &&
        ev.target !== buscador.current &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      const f: Record<string, () => void> = {
        F2: () => buscador.current?.focus(),
        F4: () => setPrecioLibre(true),
        F7: () => total > 0 && setModo({ tipo: 'cobrar', medio: 'transferencia' }),
        F8: () => total > 0 && setModo({ tipo: 'cobrar', medio: 'efectivo' }),
        F9: () => total > 0 && enLinea && setModo({ tipo: 'cobrar', medio: 'qr' }),
      };
      if (f[ev.key]) {
        ev.preventDefault();
        f[ev.key]?.();
        return;
      }
      if (enOtroCampo) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (q) setQ('');
        else if (seleccionado) setSeleccionado(null);
        else if (items.length) setConfirmarVaciar(true);
        return;
      }
      // Moverse por el ticket cuando el buscador está vacío.
      if (!q && items.length && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
        ev.preventDefault();
        const i = items.findIndex((x) => x.id === seleccionado);
        const j = ev.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : i <= 0 ? 0 : i - 1;
        setSeleccionado(items[j]?.id ?? null);
        return;
      }
      if (seleccionado && !q) {
        if (ev.key === '+') {
          ev.preventDefault();
          cambiarCantidad(seleccionado, 1);
        } else if (ev.key === '-') {
          ev.preventDefault();
          cambiarCantidad(seleccionado, -1);
        } else if (ev.key === 'Delete') {
          ev.preventDefault();
          quitarItem(seleccionado);
          setSeleccionado(null);
        }
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [modo.tipo, total, enLinea, q, seleccionado, items]);

  useEffect(() => {
    const alLeer = (ev: Event) => {
      if (modo.tipo === 'ticket') entrar((ev as CustomEvent<string>).detail);
    };
    window.addEventListener('mostrador:codigo', alLeer);
    return () => window.removeEventListener('mostrador:codigo', alLeer);
  });

  if (turno.tipo === 'cargando') return <div className="vender" aria-busy="true" />;
  if (turno.tipo === 'cerrado') return <AbrirCaja />;

  if (modo.tipo === 'cobrado') {
    return (
      <Cobrado
        venta={modo.venta}
        alNuevaVenta={() => {
          setModo({ tipo: 'ticket' });
          enfocar();
        }}
      />
    );
  }

  const cobrar = modo.tipo === 'cobrar' && (
    <Cobrar
      total={total}
      medioInicial={modo.medio}
      enPanel={esPC}
      alVolver={() => {
        setModo({ tipo: 'ticket' });
        enfocar();
      }}
      alCobrado={(venta) => setModo({ tipo: 'cobrado', venta })}
    />
  );
  if (cobrar && !esPC) return cobrar;

  const atajo = (t: string) => (teclado ? ` · ${t}` : '');

  return (
    <div className="vender">
      <header className="vender__encabezado">
        <div>
          <h1 className="m-titulo">{s.kiosco.nombre}</h1>
          <p className="texto-suave">Caja de {s.usuario.nombre || 'vos'}</p>
        </div>
        <div className="vender__estado">{estado}</div>
      </header>

      <div className="vender__columnas">
        <section className="vender__productos" aria-label="Productos">
          <div className="buscador buscador-productos">
            <label className="m-solo-lectores" htmlFor="buscar">
              Buscar producto
            </label>
            <input
              ref={buscador}
              id="buscar"
              className="buscador__campo"
              type="search"
              placeholder="Buscar producto"
              autoComplete="off"
              value={q}
              role="combobox"
              aria-expanded={resultados.length > 0}
              aria-controls="resultados-venta"
              aria-activedescendant={
                resultados[activo] ? `res-${resultados[activo].id}` : undefined
              }
              onChange={(e) => {
                setQ(e.target.value);
                setActivo(0);
                setDesconocido(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  entrar(q);
                } else if (e.key === 'ArrowDown' && resultados.length) {
                  e.preventDefault();
                  setActivo((a) => Math.min(a + 1, resultados.length - 1));
                } else if (e.key === 'ArrowUp' && resultados.length) {
                  e.preventDefault();
                  setActivo((a) => Math.max(a - 1, 0));
                }
              }}
            />
            <button
              type="button"
              className="buscador__escanear"
              onClick={() => window.dispatchEvent(new Event('mostrador:escanear'))}
            >
              Escanear
            </button>
            <span className="buscador__pista">Escaneá o escribí · F2</span>
            {resultados.length > 0 && (
              <ul
                id="resultados-venta"
                role="listbox"
                className="resultados"
                aria-label="Resultados"
              >
                {resultados.map((p, i) => (
                  <li key={p.id} id={`res-${p.id}`} role="option" aria-selected={i === activo}>
                    <button
                      type="button"
                      className="resultado"
                      tabIndex={-1}
                      onClick={() => sumar(p, cantidad)}
                    >
                      <span>
                        {cantidad > 1 && <strong>{cantidad}× </strong>}
                        {p.nombre}
                      </span>
                      <span className="m-plata">{formatearPlata(p.precio)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {desconocido && (
            <div className="aviso aviso--error desconocido" role="alert">
              <p>No encontramos el código {desconocido}.</p>
              <div className="acciones">
                {puede.editarCatalogo(s.rol) && enLinea && (
                  <button
                    type="button"
                    className="m-boton"
                    onClick={() =>
                      navegar(`/stock/producto/nuevo?codigo=${encodeURIComponent(desconocido)}`)
                    }
                  >
                    Cargar producto
                  </button>
                )}
                <button
                  type="button"
                  className="m-boton"
                  onClick={() => {
                    setDesconocido(null);
                    setPrecioLibre(true);
                  }}
                >
                  Vender con precio libre
                </button>
              </div>
            </div>
          )}

          {catalogo && catalogo.categorias.length > 0 && (
            <div className="chips chips--categorias" role="group" aria-label="Categorías">
              <button
                type="button"
                className="chip"
                aria-pressed={categoria === null}
                onClick={() => setCategoria(null)}
              >
                Todo
              </button>
              {catalogo.categorias.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="chip"
                  aria-pressed={categoria === c.id}
                  onClick={() => setCategoria(c.id)}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
          )}

          <div className="vender__titulo-mosaicos">
            <h2 className="subtitulo">
              {categoria
                ? catalogo?.categorias.find((c) => c.id === categoria)?.nombre
                : 'Más vendidos'}
            </h2>
            <span className="texto-suave">Tocá para sumar al ticket</span>
          </div>
          <div className="mosaicos">
            {mosaicos.map((p) => (
              <button key={p.id} type="button" className="mosaico" onClick={() => sumar(p)}>
                <span className="mosaico__nombre">{p.nombre}</span>
                <span className="mosaico__precio m-plata">{formatearPlata(p.precio)}</span>
              </button>
            ))}
            <button
              type="button"
              className="mosaico mosaico--libre"
              onClick={() => setPrecioLibre(true)}
            >
              <span className="mosaico__nombre">Producto sin código</span>
              <span className="mosaico__libre">Precio libre{atajo('F4')}</span>
            </button>
          </div>
          {catalogo && catalogo.productos.length === 0 && (
            <p className="vacio">Todavía no hay productos. Cargalos desde Stock.</p>
          )}
        </section>

        <aside className="vender__ticket" aria-label="Ticket y total">
          {cobrar || (
            <>
              <Ticket etiqueta="Ticket">
                <h2 className="ticket__titulo">
                  Ticket · {unidades(items)} {unidades(items) === 1 ? 'producto' : 'productos'}
                </h2>
                <hr className="m-ticket__separador" />
                {items.length === 0 ? (
                  <p className="ticket__vacio">El ticket está vacío.</p>
                ) : (
                  <ul className="ticket__lineas">
                    {items.map((x) => (
                      <li
                        key={x.id}
                        className={`ticket__linea${seleccionado === x.id ? ' ticket__linea--sel' : ''}`}
                        aria-current={seleccionado === x.id ? 'true' : undefined}
                      >
                        <span className="ticket__cant m-plata">
                          {Number.isInteger(x.cantidad)
                            ? x.cantidad
                            : x.cantidad.toLocaleString('es-AR')}
                          ×
                        </span>
                        <span className="ticket__desc">{x.descripcion}</span>
                        <span className="ticket__sub m-plata">
                          {formatearPlata(Math.round(x.cantidad * x.precioUnitario))}
                        </span>
                        <span className="ticket__botones">
                          <button
                            type="button"
                            className="ticket__boton"
                            aria-label={`Restar uno de ${x.descripcion}`}
                            onClick={() => cambiarCantidad(x.id, -1)}
                          >
                            −
                          </button>
                          <button
                            type="button"
                            className="ticket__boton"
                            aria-label={`Sumar uno de ${x.descripcion}`}
                            onClick={() => cambiarCantidad(x.id, 1)}
                          >
                            +
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Ticket>
              {items.length > 0 && (
                <button
                  type="button"
                  className="enlace-boton vaciar"
                  onClick={() => setConfirmarVaciar(true)}
                >
                  Vaciar ticket
                </button>
              )}
              <div className="vender__total">
                <CartelTotal centavos={total} />
              </div>
              {!enLinea && (
                <p className="nota-sin-qr">
                  Sin internet no se puede generar el QR de la venta. Por ahora, cobrá en efectivo.
                </p>
              )}
              {esPC ? (
                <div className="botones-cobro">
                  <button
                    type="button"
                    className="m-boton m-boton--principal"
                    disabled={!total}
                    onClick={() => setModo({ tipo: 'cobrar', medio: 'efectivo' })}
                  >
                    Cobrar en efectivo{atajo('F8')}
                  </button>
                  <button
                    type="button"
                    className="m-boton m-boton--cobro"
                    disabled={!total || !enLinea}
                    onClick={() => setModo({ tipo: 'cobrar', medio: 'qr' })}
                  >
                    {enLinea ? `Cobrar con QR${atajo('F9')}` : 'Cobrar con QR (necesita internet)'}
                  </button>
                  <button
                    type="button"
                    className="m-boton m-boton--cobro"
                    disabled={!total}
                    onClick={() => setModo({ tipo: 'cobrar', medio: 'transferencia' })}
                  >
                    Cobrar con transferencia{atajo('F7')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="m-boton m-boton--principal"
                  disabled={!total}
                  onClick={() => setModo({ tipo: 'cobrar', medio: null })}
                >
                  Cobrar
                </button>
              )}
            </>
          )}
        </aside>
      </div>

      {precioLibre && (
        <PrecioLibre
          alCerrar={() => {
            setPrecioLibre(false);
            enfocar();
          }}
        />
      )}
      {confirmarVaciar && (
        <ConfirmarVaciar
          cantidad={items.length}
          alConfirmar={() => {
            vaciarTicket();
            setConfirmarVaciar(false);
            enfocar();
          }}
          alCancelar={() => {
            setConfirmarVaciar(false);
            enfocar();
          }}
        />
      )}
    </div>
  );
}

function ConfirmarVaciar({
  cantidad,
  alConfirmar,
  alCancelar,
}: {
  cantidad: number;
  alConfirmar: () => void;
  alCancelar: () => void;
}) {
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => boton.current?.focus(), []);
  return (
    <dialog
      className="dialogo"
      open
      aria-labelledby="titulo-vaciar"
      onKeyDown={(e) => e.key === 'Escape' && alCancelar()}
    >
      <h2 id="titulo-vaciar" className="subtitulo">
        ¿Vaciar el ticket?
      </h2>
      <p>Se borran los {cantidad} productos cargados.</p>
      <div className="acciones">
        <button
          ref={boton}
          type="button"
          className="m-boton m-boton--peligro"
          onClick={alConfirmar}
        >
          Vaciar
        </button>
        <button type="button" className="m-boton" onClick={alCancelar}>
          No, seguir
        </button>
      </div>
    </dialog>
  );
}

let audio: AudioContext | null = null;
/** Sonido corto al sumar un producto. */
export function pitido(): void {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 1400;
    g.gain.value = 0.05;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.06);
  } catch {
    // Sin audio: no pasa nada.
  }
}
