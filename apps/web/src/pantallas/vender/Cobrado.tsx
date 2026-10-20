import { formatearPlata } from '@mostrador/shared';
import { Ticket } from '@mostrador/ui';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../nucleo/api.ts';
import { sincronizar } from '../../nucleo/bandeja.ts';
import {
  FacturaImpresa,
  imprimirFactura,
  type ComprobanteVenta,
  type Emisor,
  type VentaFacturada,
} from '../../componentes/FacturaImpresa.tsx';
import type { VentaHecha } from '../../nucleo/cobrar.ts';
import { cantidadEnTicket } from '../../nucleo/ticket.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';
import { TicketImpreso } from './TicketImpreso.tsx';
import { RemitoImpreso, imprimirRemito } from './RemitoImpreso.tsx';
import { TicketCambioImpreso, imprimirTicketCambio } from './TicketCambioImpreso.tsx';
import { useNegocio } from '../../nucleo/rubro.ts';
import { enPalabras, enlaceWhatsAppCliente, textoCuenta } from '../../nucleo/clientes.ts';
import { configEquipo } from '../../nucleo/equipo.ts';

type DetalleFacturado = VentaFacturada & {
  comprobantes?: ComprobanteVenta[];
  emisor?: Emisor | null;
};

/** Espera el CAE de la venta recién cobrada y la imprime como factura. */
function BotonFactura({ ventaId }: { ventaId: string }) {
  const [esperando, setEsperando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [lista, setLista] = useState<{
    venta: DetalleFacturado;
    factura: ComprobanteVenta;
    emisor: Emisor;
  } | null>(null);
  const montado = useRef(true);
  useEffect(
    () => () => {
      montado.current = false;
    },
    [],
  );

  async function pedir() {
    if (lista) return imprimirFactura();
    setEsperando(true);
    setMensaje('Esperando que ARCA autorice la factura…');
    const hasta = Date.now() + 30_000;
    while (montado.current && Date.now() < hasta) {
      await sincronizar().catch(() => false);
      const v = await api<DetalleFacturado>('GET', `/api/v1/ventas/${ventaId}`).catch(() => null);
      const f = v?.comprobantes?.find((c) => !c.anulaId);
      if (v && !f) {
        setMensaje('Esta venta no se factura: la facturación no está activa.');
        return setEsperando(false);
      }
      if (v && f?.estado === 'autorizado' && v.emisor) {
        setLista({ venta: v, factura: f, emisor: v.emisor });
        setMensaje(null);
        setEsperando(false);
        setTimeout(imprimirFactura, 50);
        return;
      }
      if (f && (f.estado === 'rechazado' || f.estado === 'cancelado')) {
        setMensaje(`No se pudo facturar. ${f.error ?? ''} Revisalo en Ventas.`);
        return setEsperando(false);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!montado.current) return;
    setMensaje('La factura todavía no salió. La podés imprimir después desde Ventas.');
    setEsperando(false);
  }

  return (
    <>
      <button
        type="button"
        className="m-boton"
        onClick={() => void pedir()}
        disabled={esperando}
        aria-busy={esperando}
      >
        Imprimir factura
      </button>
      {mensaje && (
        <p className="texto-suave" role="status">
          {mensaje}
        </p>
      )}
      {lista && (
        <FacturaImpresa comprobante={lista.factura} emisor={lista.emisor} venta={lista.venta} />
      )}
    </>
  );
}

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function Cobrado({ venta, alNuevaVenta }: { venta: VentaHecha; alNuevaVenta: () => void }) {
  const s = useSesionCompleta();
  const negocio = useNegocio();
  const conRemito = negocio.tiene('presupuestos');
  const conCambio = negocio.tiene('regalo');
  const conFactura = negocio.tiene('facturacion') && venta.total > 0;
  const boton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (configEquipo().imprimirAlCobrar) setTimeout(() => window.print(), 300);
  }, []);
  useEffect(() => {
    boton.current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        alNuevaVenta();
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [alNuevaVenta]);

  const detalle = venta.cambio
    ? venta.total === 0
      ? 'Cambio hecho, sin diferencia'
      : `Cambio hecho · Cobrada la diferencia${venta.medio === 'efectivo' ? ` · Vuelto ${formatearPlata(venta.vuelto ?? 0)}` : ' con transferencia'}`
    : venta.medio === 'cuenta_corriente' && venta.cliente
      ? `Anotado en la cuenta de ${venta.cliente.nombre} · ${enPalabras(venta.cliente.saldo)}`
      : venta.medio === 'qr_mp'
        ? `Mercado Pago confirmó el pago a las ${hora(venta.confirmadoEn ?? venta.creadaEn)}`
        : venta.medio === 'efectivo'
          ? `Cobrado en efectivo · Vuelto ${formatearPlata(venta.vuelto ?? 0)}`
          : 'Cobrado con transferencia';

  return (
    <div className="pantalla cobrado">
      <div className="cobrado__tilde" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="72" height="72">
          <circle cx="24" cy="24" r="22" fill="var(--ok)" />
          <path
            d="M14 25l7 7 13-15"
            fill="none"
            stroke="var(--bg)"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <h1 className="m-titulo" aria-live="polite">
        Cobrado
      </h1>
      <p className="cobrado__detalle">{detalle}</p>
      <div className="cobrado__ticket">
        <Ticket etiqueta="Ticket cobrado">
          <ul className="ticket__lineas">
            {venta.items.map((x) => (
              <li key={x.id} className="ticket__linea">
                <span className="ticket__cant m-plata">{cantidadEnTicket(x)}</span>
                <span className="ticket__desc">{x.descripcion}</span>
                <span className="ticket__sub m-plata">
                  {formatearPlata(Math.round(x.cantidad * x.precioUnitario))}
                </span>
              </li>
            ))}
            {venta.descuentos?.map((d, i) => (
              <li key={`promo-${i}`} className="ticket__linea ticket__linea--promo">
                <span className="ticket__cant">Promo</span>
                <span className="ticket__desc">{d.descripcion}</span>
                <span className="ticket__sub m-plata">−{formatearPlata(d.monto)}</span>
              </li>
            ))}
            {venta.cambio?.items.map((x, i) => (
              <li key={`devuelve-${i}`} className="ticket__linea ticket__linea--promo">
                <span className="ticket__cant m-plata">{x.cantidad}×</span>
                <span className="ticket__desc">Devuelve {x.descripcion}</span>
                <span className="ticket__sub m-plata">−{formatearPlata(x.importe)}</span>
              </li>
            ))}
          </ul>
          <hr className="m-ticket__separador" />
          <p className="ticket__total">
            Total <strong className="m-plata">{formatearPlata(venta.total)}</strong>
          </p>
          <span className="sello" aria-hidden="true">
            PAGADO
          </span>
        </Ticket>
      </div>
      <div className="acciones acciones--columna">
        <button
          ref={boton}
          type="button"
          className="m-boton m-boton--principal"
          onClick={alNuevaVenta}
        >
          Nueva venta
        </button>
        {conCambio && venta.regalo && (
          <button type="button" className="m-boton" onClick={imprimirTicketCambio}>
            Imprimir ticket de cambio (para regalo)
          </button>
        )}
        {conFactura && <BotonFactura ventaId={venta.id} />}
        <button type="button" className="m-boton" onClick={() => window.print()}>
          Imprimir ticket
        </button>
        {conCambio && !venta.regalo && (
          <button type="button" className="m-boton" onClick={imprimirTicketCambio}>
            Imprimir ticket de cambio
          </button>
        )}
        {venta.cliente?.telefono && (
          <a
            className="m-boton boton-enlace"
            href={enlaceWhatsAppCliente(
              venta.cliente.telefono,
              textoCuenta(
                s.kiosco.nombre,
                venta.cliente.nombre,
                venta.cliente.saldo,
                `Te anotamos una compra de ${formatearPlata(venta.total)}.`,
              ),
            )}
            target="_blank"
            rel="noopener noreferrer"
          >
            Mandarle el detalle por WhatsApp
          </a>
        )}
        {conRemito && (
          <button type="button" className="m-boton" onClick={imprimirRemito}>
            Imprimir remito sin precios
          </button>
        )}
      </div>
      <TicketImpreso venta={venta} kiosco={s.kiosco.nombre} />
      {conRemito && <RemitoImpreso venta={venta} kiosco={s.kiosco.nombre} />}
      {conCambio && <TicketCambioImpreso venta={venta} kiosco={s.kiosco.nombre} />}
    </div>
  );
}
