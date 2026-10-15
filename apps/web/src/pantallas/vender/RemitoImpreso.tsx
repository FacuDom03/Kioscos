import { formatearCantidad } from '@mostrador/shared';
import type { VentaHecha } from '../../nucleo/cobrar.ts';

/** Imprime el remito (sin precios) en la impresora de tickets. */
export function imprimirRemito(): void {
  const raiz = document.documentElement;
  raiz.classList.add('imprimiendo-remito');
  window.addEventListener('afterprint', () => raiz.classList.remove('imprimiendo-remito'), {
    once: true,
  });
  window.print();
}

/** Remito para quien retira o recibe la mercadería: cantidades sin precios. Solo al imprimir. */
export function RemitoImpreso({ venta, kiosco }: { venta: VentaHecha; kiosco: string }) {
  const f = new Date(venta.creadaEn);
  return (
    <div className="impreso remito-impreso" aria-hidden="true">
      <p className="impreso__kiosco">{kiosco}</p>
      <p>REMITO · {f.toLocaleDateString('es-AR')}</p>
      <hr />
      {venta.items.map((x) => (
        <div key={x.id} className="impreso__item">
          <span>
            {formatearCantidad(x.cantidad, x.unidad)} {x.descripcion}
          </span>
        </div>
      ))}
      <hr />
      <p>Recibí conforme:</p>
      <p>Firma y aclaración: ____________________</p>
      <p>No es un comprobante fiscal.</p>
    </div>
  );
}
