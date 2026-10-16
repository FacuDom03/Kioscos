import {
  diferenciaEnPalabras,
  formatearCantidad,
  formatearPlata,
  type Unidad,
} from '@mostrador/shared';
import { useState, type ReactNode } from 'react';
import { Aviso } from './Formulario.tsx';
import { api, mensajeDeError } from '../nucleo/api.ts';
import { hoyArgentina } from '../nucleo/descargar.ts';
import { useSesionCompleta } from '../nucleo/sesion.tsx';
import { useDatos } from '../nucleo/usar-datos.ts';

// Piezas del historial que usan las secciones Ventas, Compras, Caja y Stock: listas por período
// y el detalle de cada venta, compra o cierre al tocarlo.

export type Periodo = 1 | 7 | 30;
export type Detalle = { tipo: 'venta' | 'compra' | 'cierre'; id: string };

export const PERIODOS: [Periodo, string][] = [
  [1, 'Hoy'],
  [7, '7 días'],
  [30, '30 días'],
];

export const MEDIO: Record<string, string> = {
  efectivo: 'Efectivo',
  qr_mp: 'QR',
  transferencia: 'Transferencia',
  cuenta_corriente: 'A cuenta',
};

const MOVIMIENTO: Record<string, string> = {
  venta: 'Venta',
  compra: 'Compra',
  ajuste: 'Ajuste',
  anulacion: 'Venta anulada',
};

const ESTADO: Record<string, string> = {
  cobrada: 'Cobrada',
  anulada: 'Anulada',
  pendiente_cobro: 'Pendiente de cobro',
  abierta: 'Sin cobrar',
};

/** "16/10 14:32" en hora de la Argentina. */
export const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** La fecha de hace `dias - 1` días (hoy incluido), en la Argentina. */
export function desdeHace(dias: Periodo): string {
  const hoy = new Date(`${hoyArgentina()}T12:00:00-03:00`);
  return new Date(hoy.getTime() - (dias - 1) * 86_400_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

export function parametro(nombre: string): string | null {
  return new URLSearchParams(location.search).get(nombre);
}

/** Hoy, 7 o 30 días. */
export function ElegirPeriodo({
  periodo,
  alCambiar,
}: {
  periodo: Periodo;
  alCambiar: (p: Periodo) => void;
}) {
  return (
    <div className="chips" role="group" aria-label="Período">
      {PERIODOS.map(([p, nombre]) => (
        <button
          key={p}
          type="button"
          className="chip"
          aria-pressed={periodo === p}
          onClick={() => alCambiar(p)}
        >
          {nombre}
        </button>
      ))}
    </div>
  );
}

/** `desde=…&hasta=…` para la API. */
export const rango = (p: Periodo) => `desde=${desdeHace(p)}&hasta=${hoyArgentina()}`;

function Vacio({ texto }: { texto: string }) {
  return <p className="vacio">{texto}</p>;
}

interface VentaFila {
  id: string;
  total: number;
  estado: string;
  devolucion_pendiente: boolean;
  creada_en_dispositivo: string;
  nombre: string | null;
  medios: string[];
}

export function ListaVentas({
  url,
  deUnTurno = false,
  alQuitarTurno,
  alAbrir,
  conResumen = true,
}: {
  url: string;
  deUnTurno?: boolean;
  alQuitarTurno?: () => void;
  alAbrir: (id: string) => void;
  conResumen?: boolean;
}) {
  const { datos, error } = useDatos<VentaFila[]>(url);
  const cobradas = (datos ?? []).filter((v) => v.estado === 'cobrada');
  return (
    <section aria-label="Ventas">
      {deUnTurno && alQuitarTurno && (
        <p className="filtro-producto">
          Las ventas de un turno de caja.{' '}
          <button type="button" className="enlace-boton" onClick={alQuitarTurno}>
            Ver todas
          </button>
        </p>
      )}
      {error && <Aviso>{error}</Aviso>}
      {datos && datos.length === 0 && <Vacio texto="No hay ventas en este período." />}
      {conResumen && datos && datos.length > 0 && (
        <p className="resumen-historial">
          {cobradas.length} {cobradas.length === 1 ? 'venta' : 'ventas'} por{' '}
          <strong className="m-plata">
            {formatearPlata(cobradas.reduce((t, v) => t + v.total, 0))}
          </strong>
        </p>
      )}
      <ul className="lista-historial">
        {datos?.map((v) => (
          <li key={v.id}>
            <button type="button" className="fila-historial" onClick={() => alAbrir(v.id)}>
              <span>
                {fechaCorta(v.creada_en_dispositivo)}
                <span className="fila-historial__detalle">
                  {[v.nombre, v.medios.map((m) => MEDIO[m] ?? m).join(' y ')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="fila-historial__monto">
                <span className="m-plata">{formatearPlata(v.total)}</span>
                {v.estado !== 'cobrada' && (
                  <span className="negativo fila-historial__estado">
                    {ESTADO[v.estado] ?? v.estado}
                    {v.devolucion_pendiente ? ', devolución pendiente' : ''}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CompraFila {
  id: string;
  total: number;
  nota: string | null;
  created_at: string;
  nombre: string | null;
  productos: number;
}

export function ListaCompras({ url, alAbrir }: { url: string; alAbrir: (id: string) => void }) {
  const { datos, error } = useDatos<CompraFila[]>(url);
  return (
    <section aria-label="Compras">
      {error && <Aviso>{error}</Aviso>}
      {datos && datos.length === 0 && (
        <Vacio texto="No hay compras en este período. Cuando llegue mercadería, tocá Cargar compra." />
      )}
      <ul className="lista-historial">
        {datos?.map((c) => (
          <li key={c.id}>
            <button type="button" className="fila-historial" onClick={() => alAbrir(c.id)}>
              <span>
                {fechaCorta(c.created_at)}
                {c.nota && ` · ${c.nota}`}
                <span className="fila-historial__detalle">
                  {c.productos} {c.productos === 1 ? 'producto' : 'productos'}
                  {c.nombre && ` · Cargó ${c.nombre}`}
                </span>
              </span>
              <span className="fila-historial__monto m-plata">{formatearPlata(c.total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CierreFila {
  id: string;
  abierto_en: string;
  cerrado_en: string;
  esperado: number;
  contado: number;
  diferencia: number;
  cerro: string | null;
}

export function ListaCierres({
  desde,
  alAbrir,
}: {
  desde: string | null;
  alAbrir: (id: string) => void;
}) {
  const { datos, error } = useDatos<CierreFila[]>('/api/v1/caja/cierres');
  const filas = (datos ?? []).filter(
    (c) => !desde || new Date(c.cerrado_en) >= new Date(`${desde}T00:00:00-03:00`),
  );
  return (
    <section aria-label="Cierres de caja">
      {error && <Aviso>{error}</Aviso>}
      {datos && filas.length === 0 && <Vacio texto="No hay cierres de caja en este período." />}
      <ul className="lista-historial">
        {filas.map((c) => (
          <li key={c.id}>
            <button type="button" className="fila-historial" onClick={() => alAbrir(c.id)}>
              <span>
                Cierre del {fechaCorta(c.cerrado_en)}
                <span className="fila-historial__detalle">
                  Abrió {fechaCorta(c.abierto_en)}
                  {c.cerro && ` · Cerró ${c.cerro}`}
                </span>
              </span>
              <strong className={c.diferencia === 0 ? '' : 'negativo'}>
                {diferenciaEnPalabras(c.contado, c.esperado, formatearPlata)}
              </strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface Movimiento {
  id: string;
  producto: string;
  unidad: Unidad;
  tipo: string;
  cantidad: number;
  motivo: string | null;
  venta_id: string | null;
  compra_id: string | null;
  created_at: string;
  nombre: string | null;
}

export function ListaMovimientos({ url, alAbrir }: { url: string; alAbrir: (d: Detalle) => void }) {
  const { datos, error } = useDatos<Movimiento[]>(url);
  return (
    <section aria-label="Movimientos de stock">
      {error && <Aviso>{error}</Aviso>}
      {datos && datos.length === 0 && (
        <Vacio texto="No hubo movimientos de stock en este período." />
      )}
      <ul className="lista-historial">
        {datos?.map((m) => {
          const contenido = (
            <>
              <span>
                {m.producto}
                <span className="fila-historial__detalle">
                  {fechaCorta(m.created_at)} · {MOVIMIENTO[m.tipo] ?? m.tipo}
                  {m.motivo && ` · ${m.motivo}`}
                  {m.nombre && ` · ${m.nombre}`}
                </span>
              </span>
              <strong className={`fila-historial__monto${m.cantidad < 0 ? ' negativo' : ''}`}>
                {m.cantidad > 0 ? '+' : '−'}
                {formatearCantidad(Math.abs(m.cantidad), m.unidad)}
              </strong>
            </>
          );
          const ref: Detalle | null = m.venta_id
            ? { tipo: 'venta', id: m.venta_id }
            : m.compra_id
              ? { tipo: 'compra', id: m.compra_id }
              : null;
          const abrir = ref ? () => alAbrir(ref) : null;
          return (
            <li key={m.id}>
              {abrir ? (
                <button type="button" className="fila-historial" onClick={abrir}>
                  {contenido}
                </button>
              ) : (
                <div className="fila-historial fila-historial--fija">{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------- detalle

interface VentaDetalle {
  id: string;
  total: number;
  estado: string;
  motivo_anulacion: string | null;
  creada_en_dispositivo: string;
  items: {
    id: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    subtotal: number;
  }[];
  pagos: {
    id: string;
    medio: string;
    monto: number;
    recibido: number | null;
    vuelto: number | null;
  }[];
  descuentos: { descripcion: string; monto: number }[];
  devoluciones: { descripcion: string; cantidad: number; importe: number }[];
}

interface CompraDetalle {
  total: number;
  nota: string | null;
  created_at: string;
  nombre: string | null;
  items: {
    id: string;
    nombre: string | null;
    unidad: Unidad | null;
    cantidad: number;
    costo_unitario: number;
    subtotal: number;
  }[];
}

interface CierreDetalle {
  turno: {
    id: string;
    abierto_en: string;
    cerrado_en: string | null;
    cambio_inicial: number;
    esperado: number | null;
    contado: number | null;
    diferencia: number | null;
    nota: string | null;
    abrio: string | null;
    cerro: string | null;
  };
  resumen: {
    vendido: number;
    ventas: number;
    porMedio: Record<string, number>;
    cobrosCuenta: { efectivo: number; transferencia: number };
    gastos: number;
    retiros: number;
    deberiaHaber: number;
  };
  gastos: {
    id: string;
    tipo: string;
    monto: number;
    motivo: string;
    created_at: string;
    nombre: string | null;
  }[];
}

const TITULO = { venta: 'Venta', compra: 'Compra', cierre: 'Cierre de caja' } as const;

export function DetalleHistorial({
  detalle,
  alCerrar,
  alCambiar,
  alVerVentasDelTurno,
}: {
  detalle: Detalle;
  alCerrar: () => void;
  alCambiar?: () => void;
  alVerVentasDelTurno?: (turnoId: string) => void;
}) {
  const url =
    detalle.tipo === 'venta'
      ? `/api/v1/ventas/${detalle.id}`
      : detalle.tipo === 'compra'
        ? `/api/v1/compras/${detalle.id}`
        : `/api/v1/caja/cierres/${detalle.id}`;
  return (
    <dialog
      className="dialogo dialogo--detalle"
      open
      aria-labelledby="titulo-detalle"
      onKeyDown={(e) => e.key === 'Escape' && alCerrar()}
    >
      <h2 id="titulo-detalle" className="subtitulo">
        {TITULO[detalle.tipo]}
      </h2>
      {detalle.tipo === 'venta' && <DetalleVenta url={url} alCambiar={alCambiar} />}
      {detalle.tipo === 'compra' && <DetalleCompra url={url} />}
      {detalle.tipo === 'cierre' && (
        <DetalleCierre url={url} alVerVentasDelTurno={alVerVentasDelTurno} />
      )}
      <div className="acciones">
        <button type="button" className="m-boton" onClick={alCerrar}>
          Cerrar
        </button>
      </div>
    </dialog>
  );
}

function Linea({ izq, der, fuerte }: { izq: ReactNode; der: ReactNode; fuerte?: boolean }) {
  return (
    <div className={`detalle-linea${fuerte ? ' detalle-linea--total' : ''}`}>
      <dt>{izq}</dt>
      <dd className="m-plata">{der}</dd>
    </div>
  );
}

function DetalleVenta({ url, alCambiar }: { url: string; alCambiar?: (() => void) | undefined }) {
  const s = useSesionCompleta();
  const { datos: v, error, recargar } = useDatos<VentaDetalle>(url);
  const [aviso, setAviso] = useState<string | null>(null);
  if (error) return <Aviso>{error}</Aviso>;
  if (!v) return <p aria-busy="true">Cargando…</p>;
  const anular = async () => {
    const motivo = prompt(`Motivo para anular la venta de ${formatearPlata(v.total)}`);
    if (!motivo) return;
    try {
      const r = await api<{ devolucionPendiente: boolean }>(
        'POST',
        `/api/v1/ventas/${v.id}/anular`,
        {
          motivo,
        },
      );
      setAviso(
        r.devolucionPendiente
          ? 'Quedó anulada. Hacé la devolución desde la app de Mercado Pago y después marcala como devuelta en Caja.'
          : 'Quedó anulada y los productos volvieron al stock.',
      );
      await recargar();
      alCambiar?.();
    } catch (e) {
      setAviso(mensajeDeError(e));
    }
  };
  return (
    <>
      <p className="texto-suave">
        {fechaCorta(v.creada_en_dispositivo)} · {ESTADO[v.estado] ?? v.estado}
        {v.motivo_anulacion && ` · Motivo: ${v.motivo_anulacion}`}
      </p>
      <dl className="detalle-lineas">
        {v.items.map((i) => (
          <Linea
            key={i.id}
            izq={`${formatearCantidad(i.cantidad)} × ${i.descripcion}`}
            der={formatearPlata(i.subtotal)}
          />
        ))}
        {v.descuentos.map((d) => (
          <Linea key={d.descripcion} izq={d.descripcion} der={`−${formatearPlata(d.monto)}`} />
        ))}
        {v.devoluciones.map((d) => (
          <Linea
            key={d.descripcion}
            izq={`Devuelve ${formatearCantidad(d.cantidad)} × ${d.descripcion}`}
            der={`−${formatearPlata(d.importe)}`}
          />
        ))}
        <Linea izq="Total" der={formatearPlata(v.total)} fuerte />
        {v.pagos.map((p) => (
          <Linea
            key={p.id}
            izq={`${MEDIO[p.medio] ?? p.medio}${p.recibido ? ` (pagó con ${formatearPlata(p.recibido)})` : ''}`}
            der={formatearPlata(p.monto)}
          />
        ))}
      </dl>
      {aviso && <Aviso tipo="ok">{aviso}</Aviso>}
      {s.rol !== 'cajero' && v.estado === 'cobrada' && (
        <button type="button" className="m-boton" onClick={() => void anular()}>
          Anular esta venta
        </button>
      )}
    </>
  );
}

function DetalleCompra({ url }: { url: string }) {
  const { datos: c, error } = useDatos<CompraDetalle>(url);
  if (error) return <Aviso>{error}</Aviso>;
  if (!c) return <p aria-busy="true">Cargando…</p>;
  return (
    <>
      <p className="texto-suave">
        {fechaCorta(c.created_at)}
        {c.nombre && ` · Cargó ${c.nombre}`}
        {c.nota && ` · ${c.nota}`}
      </p>
      <dl className="detalle-lineas">
        {c.items.map((i) => (
          <Linea
            key={i.id}
            izq={`${formatearCantidad(i.cantidad, i.unidad ?? undefined)} × ${i.nombre ?? 'Producto borrado'} a ${formatearPlata(i.costo_unitario)}`}
            der={formatearPlata(i.subtotal)}
          />
        ))}
        <Linea izq="Total" der={formatearPlata(c.total)} fuerte />
      </dl>
    </>
  );
}

function DetalleCierre({
  url,
  alVerVentasDelTurno,
}: {
  url: string;
  alVerVentasDelTurno?: ((turnoId: string) => void) | undefined;
}) {
  const { datos: d, error } = useDatos<CierreDetalle>(url);
  if (error) return <Aviso>{error}</Aviso>;
  if (!d) return <p aria-busy="true">Cargando…</p>;
  const { turno: t, resumen: r } = d;
  return (
    <>
      <p className="texto-suave">
        Abrió {t.abrio ?? 'alguien'} el {fechaCorta(t.abierto_en)}
        {t.cerrado_en && ` · Cerró ${t.cerro ?? 'alguien'} el ${fechaCorta(t.cerrado_en)}`}
      </p>
      <dl className="detalle-lineas">
        <Linea izq="Cambio inicial" der={formatearPlata(t.cambio_inicial)} />
        <Linea
          izq={`Vendido (${r.ventas} ${r.ventas === 1 ? 'venta' : 'ventas'})`}
          der={formatearPlata(r.vendido)}
          fuerte
        />
        {Object.entries(r.porMedio)
          .filter(([, monto]) => monto > 0)
          .map(([medio, monto]) => (
            <Linea key={medio} izq={`· ${MEDIO[medio] ?? medio}`} der={formatearPlata(monto)} />
          ))}
        {r.cobrosCuenta.efectivo > 0 && (
          <Linea
            izq="+ Cobros de cuentas en efectivo"
            der={formatearPlata(r.cobrosCuenta.efectivo)}
          />
        )}
        {d.gastos.map((g) => (
          <Linea
            key={g.id}
            izq={`− ${g.tipo === 'retiro' ? 'Retiro' : 'Gasto'}: ${g.motivo}`}
            der={formatearPlata(g.monto)}
          />
        ))}
        <Linea izq="Debería haber" der={formatearPlata(t.esperado ?? r.deberiaHaber)} fuerte />
        {t.contado !== null && <Linea izq="Contado" der={formatearPlata(t.contado)} />}
      </dl>
      {t.contado !== null && t.esperado !== null && (
        <p className={t.diferencia === 0 ? '' : 'negativo'}>
          <strong>{diferenciaEnPalabras(t.contado, t.esperado, formatearPlata)}</strong>
        </p>
      )}
      {t.nota && <p className="texto-suave">Nota: {t.nota}</p>}
      {alVerVentasDelTurno && r.ventas > 0 && (
        <button type="button" className="m-boton" onClick={() => alVerVentasDelTurno(t.id)}>
          Ver las ventas de este turno
        </button>
      )}
    </>
  );
}
