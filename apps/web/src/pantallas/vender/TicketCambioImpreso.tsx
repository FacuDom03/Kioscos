import { diaArgentino, diaCorto, formatearCantidad, sumarDias } from '@mostrador/shared';
import type { VentaHecha } from '../../nucleo/cobrar.ts';
import { DIAS_CAMBIO, codigoDeCambio } from '../../nucleo/cambios.ts';

/** Imprime el ticket de cambio (sin precios) en la impresora de tickets. */
export function imprimirTicketCambio(): void {
  const raiz = document.documentElement;
  raiz.classList.add('imprimiendo-cambio');
  window.addEventListener('afterprint', () => raiz.classList.remove('imprimiendo-cambio'), {
    once: true,
  });
  window.print();
}

/**
 * Ticket de cambio para regalo: lo que se llevó, sin precios, hasta cuándo se cambia y el código
 * para encontrar la venta. Solo se ve al imprimir.
 */
export function TicketCambioImpreso({ venta, kiosco }: { venta: VentaHecha; kiosco: string }) {
  const dia = diaArgentino(venta.creadaEn);
  return (
    <div className="impreso cambio-impreso" aria-hidden="true">
      <p className="impreso__kiosco">{kiosco}</p>
      <p>TICKET DE CAMBIO · {diaCorto(dia)}</p>
      <hr />
      {venta.items.map((x) => (
        <div key={x.id} className="impreso__item">
          <span>
            {formatearCantidad(x.cantidad, x.unidad)} {x.descripcion}
          </span>
        </div>
      ))}
      <hr />
      <p>Cambio hasta el {diaCorto(sumarDias(dia, DIAS_CAMBIO))}</p>
      <p className="impreso__total">Código de cambio: {codigoDeCambio(venta.id)}</p>
      <p>Traé este ticket con el producto sin usar.</p>
    </div>
  );
}
