// Factura (o nota de crédito) para imprimir, con CAE y el QR de ARCA: en la impresora de tickets
// o en hoja A4 (que también sirve para guardarla en PDF y mandarla).
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
import { LogoImpreso, MarcaDeAgua, PieImpreso } from './Marca.tsx';
import { imprimirEnHoja } from '../nucleo/equipo.ts';

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
  items: {
    id: string;
    descripcion: string;
    cantidad: number;
    subtotal: number;
    precio_unitario?: number;
  }[];
  descuentos: { descripcion: string; monto: number }[];
  devoluciones: { descripcion: string; cantidad: number; importe: number }[];
  pagos?: { medio: string }[];
}

export type FormatoFactura = 'ticket' | 'hoja';

const MEDIOS: Record<string, string> = {
  efectivo: 'Contado, efectivo',
  transferencia: 'Transferencia',
  qr_mp: 'Mercado Pago',
  cuenta_corriente: 'Cuenta corriente',
};

/** "Contado, efectivo y Mercado Pago" */
const condicionDeVenta = (pagos: VentaFacturada['pagos']) => {
  const medios = [...new Set((pagos ?? []).map((p) => MEDIOS[p.medio] ?? p.medio))];
  return medios.length ? medios.join(' y ') : 'Contado';
};

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

/** Imprime la factura que está montada (una sola a la vez), en ticket o en hoja A4. */
export function imprimirFactura(formato: FormatoFactura = 'ticket'): void {
  if (formato === 'hoja') return imprimirEnHoja('imprimiendo-factura-hoja');
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

const codigo = (tipo: TipoComprobante) => String(TIPO_COMPROBANTE[tipo]).padStart(3, '0');

interface Props {
  comprobante: ComprobanteVenta;
  emisor: Emisor;
  venta: VentaFacturada;
  /** La factura que anula, si es una nota de crédito. */
  anulada?: ComprobanteVenta | undefined;
}

/**
 * La factura para imprimir, en los dos formatos (ticket térmico y hoja A4). Solo se ve al
 * imprimir. Va fuera de los diálogos para que la impresión la encuentre.
 */
export function FacturaImpresa(props: Props) {
  const c = props.comprobante;
  if (c.estado !== 'autorizado' || !c.numero) return null;
  return createPortal(
    <>
      <FacturaTicket {...props} />
      <FacturaHoja {...props} />
    </>,
    document.body,
  );
}

/** Lo que va en las líneas de detalle: productos, promos y devoluciones. */
function lineas(venta: VentaFacturada) {
  return [
    ...venta.items.map((x) => ({
      clave: x.id,
      descripcion: x.descripcion,
      cantidad: x.cantidad as number | null,
      precio: x.precio_unitario ?? null,
      importe: x.subtotal,
    })),
    ...venta.descuentos.map((d, i) => ({
      clave: `d-${i}`,
      descripcion: d.descripcion,
      cantidad: null,
      precio: null,
      importe: -d.monto,
    })),
    ...venta.devoluciones.map((d, i) => ({
      clave: `v-${i}`,
      descripcion: `Devuelve ${d.descripcion}`,
      cantidad: d.cantidad,
      precio: null,
      importe: -d.importe,
    })),
  ];
}

const plata = (n: number) => (n < 0 ? `−${formatearPlata(-n)}` : formatearPlata(n));

/** Ticket de 58 u 80 mm: el recuadro de la letra, el detalle y el CAE con el QR al lado. */
function FacturaTicket({ comprobante: c, emisor, venta, anulada }: Props) {
  const nota = c.tipo.startsWith('nota');
  return (
    <div className="impreso factura-impresa" aria-hidden="true">
      <LogoImpreso />
      <p className="impreso__kiosco">{emisor.razonSocial}</p>
      <p className="factura__chico factura__centro">{emisor.domicilio}</p>
      <p className="factura__chico factura__centro">CUIT {cuitConGuiones(emisor.cuit)}</p>
      <p className="factura__chico factura__centro">{CONDICION[emisor.condicion]}</p>
      {emisor.iibb && (
        <p className="factura__chico factura__centro">Ingresos brutos {emisor.iibb}</p>
      )}
      {emisor.inicioActividades && (
        <p className="factura__chico factura__centro">
          Inicio de actividades {diaCorto(emisor.inicioActividades)}
        </p>
      )}
      <div className="factura__cabeza">
        <div className="factura__letra">
          <span>{letraDe(c.tipo)}</span>
          <small>Cód. {codigo(c.tipo)}</small>
        </div>
        <div>
          <p className="factura__tipo">{nota ? 'NOTA DE CRÉDITO' : 'FACTURA'}</p>
          <p>N° {numeroVisible(c.puntoDeVenta, c.numero ?? 0)}</p>
          {c.fecha && <p>Fecha {diaCorto(c.fecha)}</p>}
        </div>
      </div>
      <p>A consumidor final</p>
      <p>Pago: {condicionDeVenta(venta.pagos)}</p>
      {nota && anulada?.numero && (
        <p>Anula la {nombreComprobante(anulada.tipo, anulada.puntoDeVenta, anulada.numero)}</p>
      )}
      <hr />
      {lineas(venta).map((l) => (
        <div key={l.clave} className="factura__linea">
          <p>{l.descripcion}</p>
          <div className="impreso__item">
            <span>
              {l.cantidad !== null &&
                `${formatearCantidad(l.cantidad)}${l.precio !== null ? ` × ${formatearPlata(l.precio)}` : ''}`}
            </span>
            <span>{plata(l.importe)}</span>
          </div>
        </div>
      ))}
      <hr />
      <div className="impreso__item factura__total">
        <span>TOTAL</span>
        <span>{formatearPlata(c.total)}</span>
      </div>
      <hr className="factura__doble" />
      <div className="factura__cae">
        {c.qr && <Qr texto={c.qr} tamano={96} />}
        <div>
          <p>CAE</p>
          <p className="factura__fuerte">{c.cae}</p>
          {c.caeVence && <p>Vence {diaCorto(c.caeVence)}</p>}
        </div>
      </div>
      <p className="impreso__legal">Comprobante autorizado por ARCA</p>
      {c.prueba && <p className="factura__prueba">DE PRUEBA: NO VÁLIDO COMO FACTURA</p>}
      <PieImpreso />
    </div>
  );
}

/** Hoja A4 (o PDF): el formato de las facturas de ARCA, con la letra en el centro. */
function FacturaHoja({ comprobante: c, emisor, venta, anulada }: Props) {
  const nota = c.tipo.startsWith('nota');
  return (
    <div className="factura-hoja" aria-hidden="true">
      <MarcaDeAgua />
      {c.prueba && <p className="factura-hoja__prueba">DE PRUEBA: NO VÁLIDO COMO FACTURA</p>}
      <p className="factura-hoja__original">ORIGINAL</p>
      <header className="factura-hoja__cabeza">
        <div className="factura-hoja__emisor">
          <LogoImpreso className="factura-hoja__logo" />
          <p className="factura-hoja__razon">{emisor.razonSocial}</p>
          <p>{emisor.domicilio}</p>
          <p>{CONDICION[emisor.condicion]}</p>
        </div>
        <div className="factura-hoja__medio">
          <div className="factura-hoja__letra">
            <span>{letraDe(c.tipo)}</span>
            <small>COD. {codigo(c.tipo)}</small>
          </div>
        </div>
        <div className="factura-hoja__datos">
          <p className="factura-hoja__tipo">{nota ? 'NOTA DE CRÉDITO' : 'FACTURA'}</p>
          <p>
            <strong>Punto de venta:</strong> {String(c.puntoDeVenta).padStart(5, '0')}
          </p>
          <p>
            <strong>Comprobante N°:</strong> {String(c.numero).padStart(8, '0')}
          </p>
          {c.fecha && (
            <p>
              <strong>Fecha de emisión:</strong> {diaCorto(c.fecha)}
            </p>
          )}
          <p>
            <strong>CUIT:</strong> {cuitConGuiones(emisor.cuit)}
          </p>
          {emisor.iibb && (
            <p>
              <strong>Ingresos brutos:</strong> {emisor.iibb}
            </p>
          )}
          {emisor.inicioActividades && (
            <p>
              <strong>Inicio de actividades:</strong> {diaCorto(emisor.inicioActividades)}
            </p>
          )}
        </div>
      </header>
      <section className="factura-hoja__receptor">
        <p>
          <strong>Condición frente al IVA:</strong> Consumidor final
        </p>
        <p>
          <strong>Condición de venta:</strong> {condicionDeVenta(venta.pagos)}
        </p>
        {nota && anulada?.numero && (
          <p>
            <strong>Comprobante asociado:</strong>{' '}
            {nombreComprobante(anulada.tipo, anulada.puntoDeVenta, anulada.numero)}
          </p>
        )}
      </section>
      <table className="factura-hoja__detalle">
        <thead>
          <tr>
            <th>Producto o servicio</th>
            <th>Cantidad</th>
            <th>Precio unitario</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {lineas(venta).map((l) => (
            <tr key={l.clave}>
              <td>{l.descripcion}</td>
              <td>{l.cantidad !== null ? formatearCantidad(l.cantidad) : ''}</td>
              <td>{l.precio !== null ? formatearPlata(l.precio) : ''}</td>
              <td>{plata(l.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="factura-hoja__totales">
        <p>
          <span>Subtotal</span> <span>{formatearPlata(c.total)}</span>
        </p>
        <p>
          <span>Importe otros tributos</span> <span>{formatearPlata(0)}</span>
        </p>
        <p className="factura-hoja__total">
          <span>Importe total</span> <span>{formatearPlata(c.total)}</span>
        </p>
      </section>
      <footer className="factura-hoja__pie">
        {c.qr && <Qr texto={c.qr} tamano={110} />}
        <div className="factura-hoja__autorizado">
          <p className="factura-hoja__arca">Comprobante autorizado por ARCA</p>
          <PieImpreso className="factura-hoja__texto" />
        </div>
        <div className="factura-hoja__cae">
          <p>
            <strong>CAE N°:</strong> {c.cae}
          </p>
          {c.caeVence && (
            <p>
              <strong>Vencimiento del CAE:</strong> {diaCorto(c.caeVence)}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}
