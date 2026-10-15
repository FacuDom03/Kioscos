import { diaCorto, formatearCantidad, formatearPlata, type Unidad } from '@mostrador/shared';
import { useState } from 'react';
import { Aviso, Volver } from '../../componentes/Formulario.tsx';
import { useCatalogo } from '../../nucleo/catalogo.ts';
import { useNegocio } from '../../nucleo/rubro.ts';
import { puede, useSesionCompleta } from '../../nucleo/sesion.tsx';
import { useTurno } from '../../nucleo/turno.ts';
import { navegar } from '../../nucleo/ruta.ts';
import { useDatos } from '../../nucleo/usar-datos.ts';

interface DatosTablero {
  resumen: {
    vendido: number;
    ventas: number;
    ticketPromedio: number;
    /** Lo vendido en el período anterior del mismo largo. */
    anterior: number;
    variacion: number | null;
    gremio: { vendido: number; ticketPromedio: number };
  };
  masVendidos: { id: string; nombre: string; unidad: Unidad; importe: number; cantidad: number }[];
  sinMovimiento: {
    productos: number;
    plataParada: number;
    lista: { id: string; nombre: string; unidad: Unidad; stock: number; capital: number }[];
  };
  porReponer: {
    productos: number;
    lista: { id: string; nombre: string; unidad: Unidad; stock: number; minimo: number }[];
  };
  categorias: { categoria: string; importe: number; ganancia: number | null }[];
  clientes: { deuda: number; deudores: number; sinPagarHace30: number };
  preciosViejos: number;
  porVencer: {
    lotes: number;
    vencidos: number;
    lista: { id: string; nombre: string; venceEn: string; cantidad: number }[];
  };
  promos: { descontado: number; ventas: number };
}

const PERIODOS = [
  { id: 'hoy', nombre: 'Hoy' },
  { id: '7', nombre: 'Últimos 7 días' },
  { id: '30', nombre: 'Últimos 30 días' },
  { id: '90', nombre: 'Últimos 90 días' },
] as const;

/** Barra horizontal de una sola serie: el valor siempre va escrito al lado. Decorativa. */
function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const pct = maximo > 0 ? Math.max(2, Math.round((valor / maximo) * 100)) : 0;
  return (
    <span className="barra" aria-hidden="true">
      <span className="barra__relleno" style={{ width: `${pct}%` }} />
    </span>
  );
}

const porcentaje = (n: number) => `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })} %`;

/** Tablero del comercio (etapa I6). */
export function Tablero({ alVolver }: { alVolver: () => void }) {
  const negocio = useNegocio();
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('30');
  const { datos: t, error } = useDatos<DatosTablero>(`/api/v1/tablero?periodo=${periodo}`);
  const maxVendido = Math.max(0, ...(t?.masVendidos.map((m) => m.importe) ?? []));
  const maxCategoria = Math.max(0, ...(t?.categorias.map((c) => c.importe) ?? []));
  const { catalogo } = useCatalogo();
  // Recién empezado (sin productos o sin ninguna venta todavía): en vez de cuadros vacíos, qué
  // hacer para arrancar.
  const sinNada =
    !!t &&
    !!catalogo &&
    (catalogo.productos.length === 0 || (t.resumen.ventas === 0 && t.resumen.anterior === 0));

  return (
    <div className="pantalla pantalla--ancha tablero">
      <Volver onClick={alVolver} />
      <div className="encabezado-pantalla">
        <h1 className="m-titulo">Tablero</h1>
        <div className="campo campo--en-linea">
          <label htmlFor="periodo">Período</label>
          <select
            id="periodo"
            className="campo__entrada"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value as typeof periodo)}
          >
            {PERIODOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <Aviso>{error}</Aviso>}
      {!t && !error && <div aria-busy="true" className="cargando-chico" />}
      {t && sinNada && <PrimerosPasos huboVentas={t.resumen.ventas > 0} />}
      {t && !sinNada && (
        <>
          {t.preciosViejos > 0 && negocio.tiene('precios_proveedor') && (
            <div className="aviso aviso--info tablero__aviso" role="status">
              <span>
                <strong>{t.preciosViejos} productos</strong> tienen el precio de hace más de 30
                días.
              </span>
              <button
                type="button"
                className="m-boton"
                onClick={() => navegar('/stock/proveedores')}
              >
                Actualizar precios
              </button>
            </div>
          )}

          <div className="indicadores">
            <div className="indicador">
              <span className="indicador__nombre">Vendido</span>
              <span className="indicador__valor m-plata">{formatearPlata(t.resumen.vendido)}</span>
              {t.resumen.variacion !== null && (
                <span className="indicador__detalle">
                  {t.resumen.variacion === 0
                    ? 'Igual que el período anterior'
                    : `${porcentaje(Math.abs(t.resumen.variacion))} ${t.resumen.variacion > 0 ? 'más' : 'menos'} que el período anterior`}
                </span>
              )}
            </div>
            <div className="indicador">
              <span className="indicador__nombre">Ventas</span>
              <span className="indicador__valor">{t.resumen.ventas.toLocaleString('es-AR')}</span>
            </div>
            <div className="indicador">
              <span className="indicador__nombre">Ticket promedio</span>
              <span className="indicador__valor m-plata">
                {formatearPlata(t.resumen.ticketPromedio)}
              </span>
              {negocio.tiene('listas_precios') && t.resumen.gremio.ticketPromedio > 0 && (
                <span className="indicador__detalle">
                  Gremio: {formatearPlata(t.resumen.gremio.ticketPromedio)}
                </span>
              )}
            </div>
            {negocio.tiene('promos') && (
              <button
                type="button"
                className="indicador indicador--boton"
                onClick={() => navegar('/promos')}
              >
                <span className="indicador__nombre">Descontado en promos</span>
                <span className="indicador__valor m-plata">
                  {formatearPlata(t.promos.descontado)}
                </span>
                <span className="indicador__detalle">
                  En {t.promos.ventas} {t.promos.ventas === 1 ? 'venta' : 'ventas'}
                </span>
              </button>
            )}
            {negocio.tiene('cuenta_corriente') && (
              <button
                type="button"
                className="indicador indicador--boton"
                onClick={() => navegar('/clientes')}
              >
                <span className="indicador__nombre">Te deben</span>
                <span className="indicador__valor m-plata">{formatearPlata(t.clientes.deuda)}</span>
                <span className="indicador__detalle">
                  {t.clientes.deudores} {t.clientes.deudores === 1 ? 'cliente' : 'clientes'}
                  {t.clientes.sinPagarHace30 > 0 &&
                    ` · ${t.clientes.sinPagarHace30} sin pagar hace un mes`}
                </span>
              </button>
            )}
          </div>

          <div className="tablero__secciones">
            <section className="tarjeta-tablero" aria-labelledby="t-mas">
              <h2 className="subtitulo" id="t-mas">
                Lo que más se vende
              </h2>
              {t.masVendidos.length === 0 ? (
                <p className="texto-suave">Todavía no hay ventas en este período.</p>
              ) : (
                <ul className="lista-barras">
                  {t.masVendidos.map((m) => (
                    <li key={m.id}>
                      <span className="lista-barras__texto">
                        <span>
                          {m.nombre}{' '}
                          <span className="texto-suave">
                            · {formatearCantidad(m.cantidad, m.unidad)}
                          </span>
                        </span>
                        <strong className="m-plata">{formatearPlata(m.importe)}</strong>
                      </span>
                      <Barra valor={m.importe} maximo={maxVendido} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="tarjeta-tablero" aria-labelledby="t-quietos">
              <div className="tarjeta-tablero__cabeza">
                <h2 className="subtitulo" id="t-quietos">
                  Sin ventas en 60 días
                </h2>
                {t.sinMovimiento.plataParada > 0 && (
                  <span className="texto-suave">
                    Plata parada:{' '}
                    <strong className="m-plata">
                      {formatearPlata(t.sinMovimiento.plataParada)}
                    </strong>
                  </span>
                )}
              </div>
              {t.sinMovimiento.lista.length === 0 ? (
                <p className="texto-suave">
                  Todo lo que tiene stock se vendió en los últimos 60 días.
                </p>
              ) : (
                <ul className="lista-tablero">
                  {t.sinMovimiento.lista.map((q) => (
                    <li key={q.id}>
                      <span>{q.nombre}</span>
                      <span className="texto-suave">{formatearCantidad(q.stock, q.unidad)}</span>
                      <span className="m-plata">
                        {q.capital > 0 ? formatearPlata(q.capital) : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {t.sinMovimiento.productos > t.sinMovimiento.lista.length && (
                <p className="texto-suave">
                  Y {t.sinMovimiento.productos - t.sinMovimiento.lista.length} más.
                </p>
              )}
            </section>

            <section className="tarjeta-tablero" aria-labelledby="t-reponer">
              <div className="tarjeta-tablero__cabeza">
                <h2 className="subtitulo" id="t-reponer">
                  Por reponer
                </h2>
                {t.porReponer.productos > 0 && (
                  <button type="button" className="enlace-boton" onClick={() => navegar('/stock')}>
                    {t.porReponer.productos === 1
                      ? 'Verlo en Stock'
                      : `Ver los ${t.porReponer.productos} en Stock`}
                  </button>
                )}
              </div>
              {t.porReponer.lista.length === 0 ? (
                <p className="texto-suave">No falta nada.</p>
              ) : (
                <ul className="lista-tablero">
                  {t.porReponer.lista.map((p) => (
                    <li key={p.id}>
                      <span>{p.nombre}</span>
                      <span className="texto-suave">
                        {p.stock <= 0
                          ? 'Sin stock'
                          : `Quedan ${formatearCantidad(p.stock, p.unidad)}`}{' '}
                        de {formatearCantidad(p.minimo, p.unidad)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {negocio.tiene('vencimientos') && (
              <section className="tarjeta-tablero" aria-labelledby="t-vencen">
                <div className="tarjeta-tablero__cabeza">
                  <h2 className="subtitulo" id="t-vencen">
                    Vence en 30 días
                  </h2>
                  {t.porVencer.lotes > 0 && (
                    <button
                      type="button"
                      className="enlace-boton"
                      onClick={() => navegar('/stock/vencimientos')}
                    >
                      Ver vencimientos
                    </button>
                  )}
                </div>
                {t.porVencer.lista.length === 0 ? (
                  <p className="texto-suave">No vence nada en los próximos 30 días.</p>
                ) : (
                  <ul className="lista-tablero">
                    {t.porVencer.lista.map((l, i) => (
                      <li key={`${l.id}-${i}`}>
                        <span>{l.nombre}</span>
                        <span className="texto-suave">{formatearCantidad(l.cantidad)}</span>
                        <span>{diaCorto(l.venceEn)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.porVencer.vencidos > 0 && (
                  <p className="texto-alerta">
                    {t.porVencer.vencidos === 1
                      ? 'Un lote ya venció.'
                      : `${t.porVencer.vencidos} lotes ya vencieron.`}
                  </p>
                )}
              </section>
            )}

            <section className="tarjeta-tablero" aria-labelledby="t-categorias">
              <h2 className="subtitulo" id="t-categorias">
                Por categoría
              </h2>
              {t.categorias.length === 0 ? (
                <p className="texto-suave">Todavía no hay ventas en este período.</p>
              ) : (
                <ul className="lista-barras">
                  {t.categorias.map((c) => (
                    <li key={c.categoria}>
                      <span className="lista-barras__texto">
                        <span>
                          {c.categoria}{' '}
                          <span className="texto-suave">
                            ·{' '}
                            {c.ganancia === null
                              ? 'sin costos cargados'
                              : `ganancia ${porcentaje(c.ganancia)}`}
                          </span>
                        </span>
                        <strong className="m-plata">{formatearPlata(c.importe)}</strong>
                      </span>
                      <Barra valor={c.importe} maximo={maxCategoria} />
                    </li>
                  ))}
                </ul>
              )}
              <p className="nota">
                La ganancia se calcula con el costo que tiene cargado hoy cada producto.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** Primeros pasos para un comercio que recién arranca. Cada paso se tilda solo cuando se hizo. */
function PrimerosPasos({ huboVentas }: { huboVentas: boolean }) {
  const s = useSesionCompleta();
  const negocio = useNegocio();
  const turno = useTurno();
  const { catalogo } = useCatalogo();
  const productos = catalogo?.productos.length ?? 0;
  const editar = puede.editarCatalogo(s.rol);
  const pasos = [
    {
      hecho: productos > 0,
      titulo: 'Cargá tus productos',
      detalle:
        productos > 0
          ? `Ya tenés ${productos} ${productos === 1 ? 'producto' : 'productos'}.`
          : negocio.tiene('precios_proveedor')
            ? 'Uno por uno, desde una planilla o con la lista de un proveedor.'
            : 'Uno por uno o todos juntos desde una planilla.',
      acciones: editar
        ? [
            { texto: 'Cargar un producto', ruta: '/stock/producto/nuevo' },
            { texto: 'Importar planilla', ruta: '/stock/importar' },
            ...(negocio.tiene('precios_proveedor')
              ? [{ texto: 'Lista de proveedor', ruta: '/stock/proveedores' }]
              : []),
          ]
        : [],
    },
    {
      hecho: turno.tipo === 'abierto',
      titulo: 'Abrí la caja',
      detalle: 'Con el cambio con el que arrancás el día. Al cerrar, la caja te dice si cierra.',
      acciones: [{ texto: turno.tipo === 'abierto' ? 'Ver la caja' : 'Abrir la caja', ruta: '/' }],
    },
    {
      hecho: huboVentas,
      titulo: 'Hacé la primera venta',
      detalle: 'Escaneá el código, buscá por nombre o tocá el producto, y cobrá.',
      acciones: [{ texto: 'Ir a vender', ruta: '/' }],
    },
    ...(s.rol === 'dueno'
      ? [
          {
            hecho: false,
            titulo: 'Sumá a quien atiende',
            detalle: 'Cada cajero entra con su PIN, y vos ves quién vendió qué.',
            acciones: [
              { texto: 'Usuarios', ruta: '/mas/usuarios' },
              { texto: 'Autorizar esta PC', ruta: '/mas/dispositivos' },
            ],
          },
        ]
      : []),
  ];
  return (
    <section className="tarjeta-tablero primeros-pasos" aria-labelledby="t-pasos">
      <h2 className="subtitulo" id="t-pasos">
        Primeros pasos
      </h2>
      <p className="texto-suave">
        Cuando empieces a vender, acá vas a ver qué se vende más, qué no se mueve, qué falta y
        cuánto ganás por categoría.
      </p>
      <ol className="pasos">
        {pasos.map((p) => (
          <li key={p.titulo} className={`paso${p.hecho ? ' paso--hecho' : ''}`}>
            <span className="paso__marca" aria-hidden="true">
              {p.hecho ? '✓' : ''}
            </span>
            <span className="paso__texto">
              <strong>
                {p.titulo}
                {p.hecho && <span className="m-solo-lectores"> (hecho)</span>}
              </strong>
              <span className="texto-suave">{p.detalle}</span>
            </span>
            {!p.hecho && p.acciones.length > 0 && (
              <span className="paso__acciones">
                {p.acciones.map((a) => (
                  <button
                    key={a.texto}
                    type="button"
                    className="m-boton"
                    onClick={() => navegar(a.ruta)}
                  >
                    {a.texto}
                  </button>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
