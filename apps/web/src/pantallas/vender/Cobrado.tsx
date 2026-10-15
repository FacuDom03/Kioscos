import { formatearPlata } from '@mostrador/shared';
import { Ticket } from '@mostrador/ui';
import { useEffect, useRef } from 'react';
import type { VentaHecha } from '../../nucleo/cobrar.ts';
import { cantidadEnTicket } from '../../nucleo/ticket.ts';
import { useSesionCompleta } from '../../nucleo/sesion.tsx';
import { TicketImpreso } from './TicketImpreso.tsx';
import { RemitoImpreso, imprimirRemito } from './RemitoImpreso.tsx';
import { useNegocio } from '../../nucleo/rubro.ts';
import { configEquipo } from '../../nucleo/equipo.ts';

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

export function Cobrado({ venta, alNuevaVenta }: { venta: VentaHecha; alNuevaVenta: () => void }) {
  const s = useSesionCompleta();
  const conRemito = useNegocio().tiene('presupuestos');
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

  const detalle =
    venta.medio === 'qr_mp'
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
        <button type="button" className="m-boton" onClick={() => window.print()}>
          Imprimir ticket
        </button>
        {conRemito && (
          <button type="button" className="m-boton" onClick={imprimirRemito}>
            Imprimir remito sin precios
          </button>
        )}
      </div>
      <TicketImpreso venta={venta} kiosco={s.kiosco.nombre} />
      {conRemito && <RemitoImpreso venta={venta} kiosco={s.kiosco.nombre} />}
    </div>
  );
}
