import {
  DATOS_RUBROS,
  DATOS_UNIDADES,
  formatearCantidad,
  formatearPlata,
  leerCodigoBalanza,
  seFracciona,
} from '@mostrador/shared';
import { CartelTotal, Ticket } from '@mostrador/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  buscarProductos,
  grupoPorId,
  productoPorCodigo,
  useCatalogo,
  variantesDe,
  type Producto,
} from '../../nucleo/catalogo.ts';
import { useEnLinea } from '../../nucleo/conexion.ts';
import { useEsPC, useHayTeclado } from '../../nucleo/medios.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import {
  cambiarCantidad,
  cantidadEnTicket,
  cuentaTicket,
  fijarLista,
  precioEnLista,
  quitarItem,
  sumarPrecioLibre,
  sumarProducto,
  unidades,
  soltarCambio,
  soltarPresupuesto,
  useCambio,
  useLista,
  usePresupuesto,
  useTicket,
  vaciarTicket,
} from '../../nucleo/ticket.ts';
import { GuardarPresupuesto } from './GuardarPresupuesto.tsx';
import { useNegocio } from '../../nucleo/rubro.ts';
import { CantidadProducto } from './CantidadProducto.tsx';
import { useTurno } from '../../nucleo/turno.ts';
import type { VentaHecha } from '../../nucleo/cobrar.ts';
import { AbrirCaja } from './AbrirCaja.tsx';
import { Escaner } from '../../componentes/Escaner.tsx';
import { configEquipo } from '../../nucleo/equipo.ts';
import { useEstadoMp } from '../../nucleo/mp.ts';
import { Cobrado } from './Cobrado.tsx';
import { Cobrar, type Medio } from './Cobrar.tsx';
import { PrecioLibre } from './PrecioLibre.tsx';
import { ElegirVariante } from './ElegirVariante.tsx';

/** Un renglón de los resultados: un producto, o un producto con variantes (todos sus tonos). */
type Resultado =
  | { tipo: 'producto'; id: string; p: Producto }
  | { tipo: 'grupo'; id: string; nombre: string; variantes: Producto[] };

/** Junta en un renglón los tonos de un mismo producto cuando aparece más de uno. */
function agrupar(lista: Producto[], max: number, siempre = false): Resultado[] {
  const cuantos = new Map<string, number>();
  for (const p of lista) if (p.grupoId) cuantos.set(p.grupoId, (cuantos.get(p.grupoId) ?? 0) + 1);
  const salida: Resultado[] = [];
  const vistos = new Set<string>();
  for (const p of lista) {
    if (salida.length >= max) break;
    const variantes = p.grupoId ? variantesDe(p.grupoId) : [];
    if (p.grupoId && variantes.length > 1 && (siempre || (cuantos.get(p.grupoId) ?? 0) > 1)) {
      if (vistos.has(p.grupoId)) continue;
      vistos.add(p.grupoId);
      salida.push({
        tipo: 'grupo',
        id: p.grupoId,
        nombre: grupoPorId(p.grupoId)?.nombre ?? p.nombre,
        variantes,
      });
    } else salida.push({ tipo: 'producto', id: p.id, p });
  }
  return salida;
}

const PREGUNTA_VARIANTE = {
  tono: 'tonos',
  tamano: 'tamaños',
  aroma: 'aromas',
  talle: 'talles',
  otro: 'opciones',
} as const;

type Modo =
  | { tipo: 'ticket' }
  | { tipo: 'cobrar'; medio: Medio | null }
  | { tipo: 'cobrado'; venta: VentaHecha };

/** "3*779..." suma 3 unidades; "12,5*cable" suma 12,5 metros. Sin "*", la cantidad no se dijo. */
function separarCantidad(texto: string): { cantidad: number | undefined; resto: string } {
  const m = /^(\d{1,4}(?:[.,]\d{1,3})?)\*(.*)$/.exec(texto.trim());
  const n = m ? Number((m[1] ?? '').replace(',', '.')) : 0;
  return m && n > 0
    ? { cantidad: n, resto: (m[2] ?? '').trim() }
    : { cantidad: undefined, resto: texto.trim() };
}

export function Vender({ estado }: { estado: ReactNode }) {
  const s = useSesionCompleta();
  const turno = useTurno();
  const { catalogo } = useCatalogo();
  const items = useTicket();
  const esPC = useEsPC();
  const teclado = useHayTeclado();
  const enLinea = useEnLinea();
  const mp = useEstadoMp();
  const qrDisponible = enLinea && !!mp?.puedeCobrar;
  const negocio = useNegocio();
  const fraccionada = negocio.tiene('venta_fraccionada');
  const conListas = negocio.tiene('listas_precios');
  const conUbicacion = negocio.tiene('ubicaciones');
  const sobrio = DATOS_RUBROS[negocio.rubro].estilo === 'sobrio';
  const lista = useLista();
  const conPresupuestos = negocio.tiene('presupuestos');
  const presupuesto = usePresupuesto();
  const cambio = useCambio();
  const conCambios = negocio.tiene('regalo');
  const [guardarPresupuesto, setGuardarPresupuesto] = useState(false);
  const [elegirVariante, setElegirVariante] = useState<string | null>(null);
  const [pedirCantidad, setPedirCantidad] = useState<Producto | null>(null);
  const [q, setQ] = useState('');
  const [activo, setActivo] = useState(0);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>({ tipo: 'ticket' });
  const [precioLibre, setPrecioLibre] = useState(false);
  const [desconocido, setDesconocido] = useState<string | null>(null);
  const [confirmarVaciar, setConfirmarVaciar] = useState(false);
  const [escaner, setEscaner] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);
  const cuenta = cuentaTicket(items);
  const total = cuenta.total;
  // Un cambio por algo del mismo valor se confirma sin cobrar nada.
  const puedeCobrar = items.length > 0 && (total > 0 || (!!cambio && total === 0));
  const qrPosible = qrDisponible && !cambio;

  const { cantidad, resto } = separarCantidad(q);
  const resultados = resto ? agrupar(buscarProductos(resto, 30), 8) : [];

  const mosaicos = useMemo(() => {
    if (!catalogo) return [];
    if (categoria)
      return agrupar(
        catalogo.productos.filter((p) => p.categoriaId === categoria),
        23,
        true,
      );
    const porId = new Map(catalogo.productos.map((p) => [p.id, p]));
    const top = catalogo.masVendidos.map((id) => porId.get(id)).filter((p): p is Producto => !!p);
    const relleno = catalogo.productos.filter((p) => !catalogo.masVendidos.includes(p.id));
    return agrupar([...top, ...relleno], esPC ? 17 : 11, true);
  }, [catalogo, categoria, esPC]);

  // Vuelve al buscador, salvo que haya un diálogo abierto o el foco ya esté en otro campo
  // (por ejemplo, "¿Con cuánto paga?" si se apretó F8 enseguida).
  const enfocar = () =>
    setTimeout(() => {
      if (document.querySelector('dialog[open]')) return;
      const a = document.activeElement;
      const enOtroCampo =
        a instanceof HTMLElement &&
        a !== buscador.current &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (!enOtroCampo) buscador.current?.focus();
    }, 0);

  function elegir(r: Resultado, n?: number) {
    if (r.tipo === 'producto') return sumar(r.p, n);
    setElegirVariante(r.id);
    setQ('');
    setActivo(0);
  }

  function sumar(p: Producto, n?: number) {
    // Lo que se vende por metro, kilo o litro pregunta cuánto (salvo "12,5*cable").
    if (n === undefined && fraccionada && seFracciona(p.unidad)) {
      setPedirCantidad(p);
      setQ('');
      setActivo(0);
      return;
    }
    sumarProducto(p, seFracciona(p.unidad) ? (n ?? 1) : Math.max(1, Math.round(n ?? 1)));
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
    const eq = configEquipo().balanza;
    const balanza = eq.activa ? leerCodigoBalanza(r, eq) : null;
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
    const primero = agrupar(buscarProductos(r, 30), 8)[activo];
    if (primero) elegir(primero, n);
  }

  // Lector USB (y atajos de teclado en PC).
  useEffect(() => {
    if (modo.tipo !== 'ticket') return;
    const alTeclear = (ev: KeyboardEvent) => {
      // Con un diálogo abierto (cantidad, precio libre), las teclas son del diálogo.
      if (document.querySelector('dialog[open]')) return;
      const enOtroCampo =
        ev.target instanceof HTMLElement &&
        ev.target !== buscador.current &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
      const f: Record<string, () => void> = {
        F2: () => buscador.current?.focus(),
        ...(conListas ? { F3: () => fijarLista(lista === 'gremio' ? 'mostrador' : 'gremio') } : {}),
        F4: () => setPrecioLibre(true),
        ...(conPresupuestos
          ? { F6: () => items.length > 0 && enLinea && !cambio && setGuardarPresupuesto(true) }
          : {}),
        F7: () => puedeCobrar && setModo({ tipo: 'cobrar', medio: 'transferencia' }),
        F8: () => puedeCobrar && setModo({ tipo: 'cobrar', medio: 'efectivo' }),
        F9: () => total > 0 && qrPosible && setModo({ tipo: 'cobrar', medio: 'qr' }),
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
  }, [
    modo.tipo,
    total,
    puedeCobrar,
    qrPosible,
    q,
    seleccionado,
    items,
    conListas,
    lista,
    conPresupuestos,
    enLinea,
    cambio,
  ]);

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
        <div className="vender__acciones">
          {conCambios && !cambio && (
            <button type="button" className="chip" onClick={() => navegar('/cambios')}>
              Cambio
            </button>
          )}
          {conPresupuestos && (
            <button type="button" className="chip" onClick={() => navegar('/presupuestos')}>
              Presupuestos
            </button>
          )}
          {conListas && (
            <div className="chips lista-precios" role="group" aria-label="Lista de precios">
              <button
                type="button"
                className="chip"
                aria-pressed={lista === 'mostrador'}
                onClick={() => fijarLista('mostrador')}
              >
                Mostrador
              </button>
              <button
                type="button"
                className="chip"
                aria-pressed={lista === 'gremio'}
                onClick={() => fijarLista('gremio')}
              >
                Gremio{atajo('F3')}
              </button>
            </div>
          )}
          <div className="vender__estado">{estado}</div>
        </div>
      </header>

      {presupuesto && (
        <div className="banda-presupuesto" role="status">
          <span>Estás cobrando el presupuesto {presupuesto.numero}.</span>
          <button type="button" className="enlace-boton" onClick={soltarPresupuesto}>
            Ya no es ese presupuesto
          </button>
        </div>
      )}

      {cambio && (
        <div className="banda-presupuesto banda-cambio" role="status">
          <span>
            Cambio del ticket {cambio.codigo}: devuelve{' '}
            {cambio.items.map((x) => x.descripcion).join(', ')}. Sumá lo que se lleva.
          </span>
          <button type="button" className="enlace-boton" onClick={soltarCambio}>
            Cancelar el cambio
          </button>
        </div>
      )}

      <div className="vender__columnas">
        <section className="vender__productos" aria-label="Productos">
          <div className="buscador buscador-productos">
            <label className="m-solo-lectores" htmlFor="buscar">
              Buscar producto
            </label>
            <input
              ref={buscador}
              data-recibe-codigo
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
            <button type="button" className="buscador__escanear" onClick={() => setEscaner(true)}>
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
                {resultados.map((r, i) =>
                  r.tipo === 'grupo' ? (
                    <li key={r.id} id={`res-${r.id}`} role="option" aria-selected={i === activo}>
                      <button
                        type="button"
                        className="resultado"
                        tabIndex={-1}
                        onClick={() => elegir(r)}
                      >
                        <span className="resultado__texto">
                          <span>{r.nombre}</span>
                          <span className="resultado__info">
                            <Muestras variantes={r.variantes} />
                            {r.variantes.length}{' '}
                            {PREGUNTA_VARIANTE[grupoPorId(r.id)?.tipo ?? 'otro']}
                          </span>
                        </span>
                        <span className="m-plata resultado__precio">
                          {precioDeGrupo(r.variantes, (p) => precioEnLista(p, lista))}
                        </span>
                      </button>
                    </li>
                  ) : (
                    <li key={r.id} id={`res-${r.id}`} role="option" aria-selected={i === activo}>
                      <button
                        type="button"
                        className="resultado"
                        tabIndex={-1}
                        onClick={() => elegir(r, cantidad)}
                      >
                        <span className="resultado__texto">
                          <span>
                            {cantidad !== undefined && (
                              <strong>
                                {seFracciona(r.p.unidad)
                                  ? formatearCantidad(cantidad, r.p.unidad)
                                  : `${Math.max(1, Math.round(cantidad))}×`}{' '}
                              </strong>
                            )}
                            {r.p.nombre}
                          </span>
                          {sobrio && (
                            <span className="resultado__info">
                              {conUbicacion && r.p.ubicacion && `${r.p.ubicacion} · `}
                              Quedan {formatearCantidad(r.p.stock, r.p.unidad)}
                            </span>
                          )}
                        </span>
                        <span className="m-plata resultado__precio">
                          {formatearPlata(precioEnLista(r.p, lista))}
                          {r.p.unidad && r.p.unidad !== 'unidad' && (
                            <span className="resultado__unidad">
                              {' '}
                              /{DATOS_UNIDADES[r.p.unidad].corta}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ),
                )}
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
            {mosaicos.map((r) =>
              r.tipo === 'grupo' ? (
                <button key={r.id} type="button" className="mosaico" onClick={() => elegir(r)}>
                  <span className="mosaico__nombre">{r.nombre}</span>
                  <span className="mosaico__variantes">
                    <Muestras variantes={r.variantes} />
                    {r.variantes.length} {PREGUNTA_VARIANTE[grupoPorId(r.id)?.tipo ?? 'otro']}
                  </span>
                  <span className="mosaico__precio m-plata">
                    {precioDeGrupo(r.variantes, (p) => precioEnLista(p, lista))}
                  </span>
                </button>
              ) : (
                <button key={r.id} type="button" className="mosaico" onClick={() => sumar(r.p)}>
                  <span className="mosaico__nombre">{r.p.nombre}</span>
                  <span className="mosaico__precio m-plata">
                    {formatearPlata(precioEnLista(r.p, lista))}
                    {r.p.unidad && r.p.unidad !== 'unidad' && seFracciona(r.p.unidad) && (
                      <span className="mosaico__unidad"> /{DATOS_UNIDADES[r.p.unidad].corta}</span>
                    )}
                  </span>
                </button>
              ),
            )}
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
                  // Se puede enfocar: en pantallas chicas la lista se desplaza.
                  <ul className="ticket__lineas" tabIndex={0} aria-label="Productos del ticket">
                    {items.map((x) => (
                      <li
                        key={x.id}
                        className={`ticket__linea${seleccionado === x.id ? ' ticket__linea--sel' : ''}`}
                        aria-current={seleccionado === x.id ? 'true' : undefined}
                      >
                        <span className="ticket__cant m-plata">{cantidadEnTicket(x)}</span>
                        <span className="ticket__desc">
                          {x.descripcion}
                          {x.unidad && seFracciona(x.unidad) && (
                            <span className="ticket__detalle">
                              {formatearPlata(x.precioUnitario)}{' '}
                              {DATOS_UNIDADES[x.unidad].precioPor}
                            </span>
                          )}
                        </span>
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
                    {cuenta.descuentos.map((d) => (
                      <li key={d.promoId} className="ticket__linea ticket__linea--promo">
                        <span className="ticket__cant">Promo</span>
                        <span className="ticket__desc">{d.descripcion}</span>
                        <span className="ticket__sub m-plata">−{formatearPlata(d.monto)}</span>
                      </li>
                    ))}
                    {cambio?.items.map((x) => (
                      <li key={x.itemId} className="ticket__linea ticket__linea--promo">
                        <span className="ticket__cant m-plata">
                          {formatearCantidad(x.cantidad)}×
                        </span>
                        <span className="ticket__desc">Devuelve {x.descripcion}</span>
                        <span className="ticket__sub m-plata">−{formatearPlata(x.importe)}</span>
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
                <CartelTotal centavos={Math.max(0, total)} />
              </div>
              {total < 0 && (
                <p className="aviso aviso--info" role="status">
                  Faltan {formatearPlata(-total)}: lo que se lleva tiene que valer lo mismo o más
                  que lo que devuelve.
                </p>
              )}
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
                    disabled={!puedeCobrar}
                    onClick={() => setModo({ tipo: 'cobrar', medio: 'efectivo' })}
                  >
                    {cambio && total === 0
                      ? 'Confirmar el cambio'
                      : `Cobrar en efectivo${atajo('F8')}`}
                  </button>
                  {!cambio && (
                    <button
                      type="button"
                      className="m-boton m-boton--cobro"
                      disabled={!puedeCobrar || !qrDisponible}
                      onClick={() => setModo({ tipo: 'cobrar', medio: 'qr' })}
                    >
                      {!enLinea
                        ? 'Cobrar con QR (necesita internet)'
                        : qrDisponible
                          ? `Cobrar con QR${atajo('F9')}`
                          : 'Cobrar con QR (conectá Mercado Pago)'}
                    </button>
                  )}
                  {!(cambio && total === 0) && (
                    <button
                      type="button"
                      className="m-boton m-boton--cobro"
                      disabled={!puedeCobrar}
                      onClick={() => setModo({ tipo: 'cobrar', medio: 'transferencia' })}
                    >
                      Cobrar con transferencia{atajo('F7')}
                    </button>
                  )}
                  {conPresupuestos && !cambio && (
                    <button
                      type="button"
                      className="m-boton"
                      disabled={!items.length || !enLinea}
                      onClick={() => setGuardarPresupuesto(true)}
                    >
                      Guardar presupuesto{atajo('F6')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="m-boton m-boton--principal"
                    disabled={!puedeCobrar}
                    onClick={() =>
                      setModo({ tipo: 'cobrar', medio: cambio && total === 0 ? 'efectivo' : null })
                    }
                  >
                    {cambio && total === 0 ? 'Confirmar el cambio' : 'Cobrar'}
                  </button>
                  {conPresupuestos && !cambio && (
                    <button
                      type="button"
                      className="m-boton"
                      disabled={!items.length || !enLinea}
                      onClick={() => setGuardarPresupuesto(true)}
                    >
                      Guardar presupuesto
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </aside>
      </div>

      {escaner && (
        <Escaner
          alLeer={(codigo) => entrar(codigo)}
          alCerrar={() => {
            setEscaner(false);
            enfocar();
          }}
        />
      )}
      {guardarPresupuesto && (
        <GuardarPresupuesto
          alCerrar={() => {
            setGuardarPresupuesto(false);
            enfocar();
          }}
          alGuardar={(r) => {
            setGuardarPresupuesto(false);
            navegar(`/presupuestos/${r.id}`);
          }}
        />
      )}
      {elegirVariante && (
        <ElegirVariante
          grupoId={elegirVariante}
          alSumar={() => pitido()}
          alCerrar={() => {
            setElegirVariante(null);
            enfocar();
          }}
        />
      )}
      {pedirCantidad && (
        <CantidadProducto
          producto={pedirCantidad}
          alCerrar={() => {
            setPedirCantidad(null);
            enfocar();
          }}
        />
      )}
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

/** Muestras de color de los tonos (hasta seis). */
export function Muestras({ variantes }: { variantes: Producto[] }) {
  const conColor = variantes.filter((v) => v.color).slice(0, 6);
  if (!conColor.length) return null;
  return (
    <span className="muestras" aria-hidden="true">
      {conColor.map((v) => (
        <span key={v.id} className="muestra" style={{ background: v.color ?? undefined }} />
      ))}
    </span>
  );
}

/** "$ 3.200" si todos valen lo mismo; "desde $ 2.900" si no. */
function precioDeGrupo(variantes: Producto[], precio: (p: Producto) => number): string {
  const precios = variantes.map(precio);
  const min = Math.min(...precios);
  return precios.every((x) => x === min) ? formatearPlata(min) : `desde ${formatearPlata(min)}`;
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
