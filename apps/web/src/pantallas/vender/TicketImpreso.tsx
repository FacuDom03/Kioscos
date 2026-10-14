import { formatearPlata } from '@mostrador/shared';
import type { VentaHecha } from '../../nucleo/cobrar.ts';
import { cantidadEnTicket } from '../../nucleo/ticket.ts';

const MEDIOS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  qr_mp: 'QR Mercado Pago',
} as const;

/** Ticket para impresora térmica de 58 u 80 mm. Solo se ve al imprimir (sección 14.3). */
export function TicketImpreso({ venta, kiosco }: { venta: VentaHecha; kiosco: string }) {
  const f = new Date(venta.creadaEn);
  return (
    <div className="impreso" aria-hidden="true">
      <p className="impreso__kiosco">{kiosco}</p>
      <p>
        {f.toLocaleDateString('es-AR')}{' '}
        {f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
      </p>
      <hr />
      {venta.items.map((x) => (
        <div key={x.id} className="impreso__item">
          <span>
            {cantidadEnTicket(x)} {x.descripcion}
          </span>
          <span>{formatearPlata(Math.round(x.cantidad * x.precioUnitario))}</span>
        </div>
      ))}
      <hr />
      <div className="impreso__item impreso__total">
        <span>TOTAL</span>
        <span>{formatearPlata(venta.total)}</span>
      </div>
      {venta.lista === 'gremio' && <p>Precios de gremio</p>}
      <p>Pago: {MEDIOS[venta.medio]}</p>
      {venta.medio === 'efectivo' && venta.recibido !== undefined && (
        <p>
          Recibido {formatearPlata(venta.recibido)} · Vuelto {formatearPlata(venta.vuelto ?? 0)}
        </p>
      )}
      <hr />
      <p className="impreso__legal">Documento no válido como factura</p>
    </div>
  );
}
