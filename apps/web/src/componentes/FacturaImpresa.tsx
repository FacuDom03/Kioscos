// Factura (o nota de crédito) impresa en la impresora de tickets, con CAE y el QR de ARCA.
import {
  TIPO_COMPROBANTE,
  diaCorto,
  formatearCantidad,
  formatearPlata,
  letraDe,
  numeroVisible,
  type TipoComprobante,
} from '@mostrador/shared';
import { encode } from 'uqr';
import { createPortal } from 'react-dom';
import { LogoImpreso, PieImpreso } from './Marca.tsx';

export interface ComprobanteVenta {
  id: string;
  tipo: TipoComprobante;
  puntoDeVenta: number;
  numero: number | null;
  fecha: string | null;
  total: number;
  estado: 'pendiente' | 'autorizado' | 'rechazado' | 'cancelado';
  cae: string | null;
  caeVence: string | null;
  error: string | null;
  prueba: boolean;
  anulaId: string | null;
  qr: string | null;
}

export interface Emisor {
  cuit: string;
  razonSocial: string;
  condicion: 'monotributo' | 'exento' | 'responsable_inscripto';
  domicilio: string;
  iibb: string | null;
  inicioActividades: string | null;
}

/** Lo de la venta que va en la factura. */
export interface VentaFacturada {
  items: { id: string; descripcion: string; cantidad: number; subtotal: number }[];
  descuentos: { descripcion: string; monto: number }[];
  devoluciones: { descripcion: string; cantidad: number; importe: number }[];
}

/** "Factura C 00003-00000124" */
export const nombreComprobante = (
  tipo: TipoComprobante,
  puntoDeVenta: number,
  numero: number | null,
) =>
  `${tipo.startsWith('nota') ? 'Nota de crédito' : 'Factura'} ${letraDe(tipo)}${numero ? ` ${numeroVisible(puntoDeVenta, numero)}` : ''}`;

const CONDICION = {
  monotributo: 'Responsable Monotributo',
  exento: 'IVA Exento',
  responsable_inscripto: 'IVA Responsable Inscripto',
} as const;

const cuitConGuiones = (c: string) => `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;

/** Imprime la factura que está montada (una sola a la vez). */
export function imprimirFactura(): void {
  const raiz = document.documentElement;
  raiz.classList.add('imprimiendo-factura');
  window.addEventListener('afterprint', () => raiz.classList.remove('imprimiendo-factura'), {
    once: true,
  });
  window.print();
}

/** QR en SVG, módulo por módulo (sin HTML armado con strings). */
export function Qr({ texto, tamano = 120 }: { texto: string; tamano?: number }) {
  const { data, size } = encode(texto, { ecc: 'M', border: 2 });
  let d = '';
  data.forEach((fila, y) =>
    fila.forEach((negro, x) => {
      if (negro) d += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      width={tamano}
      height={tamano}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Solo se ve al imprimir. Va fuera de los diálogos para que la impresión la encuentre. */
export function FacturaImpresa({
  comprobante: c,
  emisor,
  venta,
  anulada,
}: {
  comprobante: ComprobanteVenta;
  emisor: Emisor;
  venta: VentaFacturada;
  /** La factura que anula, si es una nota de crédito. */
  anulada?: ComprobanteVenta | undefined;
}) {
  if (c.estado !== 'autorizado' || !c.numero) return null;
  const nota = c.tipo.startsWith('nota');
  return createPortal(
    <div className="impreso factura-impresa" aria-hidden="true">
      <LogoImpreso />
      <p className="impreso__kiosco">{emisor.razonSocial}</p>
      <p>CUIT {cuitConGuiones(emisor.cuit)}</p>
      <p>{emisor.domicilio}</p>
      <p>{CONDICION[emisor.condicion]}</p>
      {emisor.iibb && <p>Ingresos brutos: {emisor.iibb}</p>}
      {emisor.inicioActividades && (
        <p>Inicio de actividades: {diaCorto(emisor.inicioActividades)}</p>
      )}
      <hr />
      <p className="impreso__tipo">
        {nota ? 'NOTA DE CRÉDITO' : 'FACTURA'} {letraDe(c.tipo)}
      </p>
      <p className="impreso__legal">Cód. {String(TIPO_COMPROBANTE[c.tipo]).padStart(3, '0')}</p>
      <p>N° {numeroVisible(c.puntoDeVenta, c.numero)}</p>
      {c.fecha && <p>Fecha: {diaCorto(c.fecha)}</p>}
      <p>A consumidor final</p>
      {nota && anulada?.numero && (
        <p>Anula la {nombreComprobante(anulada.tipo, anulada.puntoDeVenta, anulada.numero)}</p>
      )}
      <hr />
      {venta.items.map((x) => (
        <div key={x.id} className="impreso__item">
          <span>
            {formatearCantidad(x.cantidad)} {x.descripcion}
          </span>
          <span>{formatearPlata(x.subtotal)}</span>
        </div>
      ))}
      {venta.descuentos.map((d, i) => (
        <div key={`d-${i}`} className="impreso__item">
          <span>{d.descripcion}</span>
          <span>−{formatearPlata(d.monto)}</span>
        </div>
      ))}
      {venta.devoluciones.map((d, i) => (
        <div key={`v-${i}`} className="impreso__item">
          <span>
            Devuelve {formatearCantidad(d.cantidad)} {d.descripcion}
          </span>
          <span>−{formatearPlata(d.importe)}</span>
        </div>
      ))}
      <hr />
      <div className="impreso__item impreso__total">
        <span>TOTAL</span>
        <span>{formatearPlata(c.total)}</span>
      </div>
      <hr />
      <p>CAE: {c.cae}</p>
      {c.caeVence && <p>Vencimiento del CAE: {diaCorto(c.caeVence)}</p>}
      {c.qr && (
        <div className="impreso__qr">
          <Qr texto={c.qr} />
        </div>
      )}
      <p className="impreso__legal">Comprobante autorizado por ARCA</p>
      <PieImpreso />
      {c.prueba && <p className="impreso__legal">DE PRUEBA: NO VÁLIDO COMO FACTURA</p>}
    </div>,
    document.body,
  );
}
