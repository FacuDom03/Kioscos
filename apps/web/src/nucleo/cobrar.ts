import { uuidv7 } from '@mostrador/shared';
import { encolar } from './bandeja.ts';
import {
  listaActual,
  presupuestoActual,
  ticketActual,
  totalTicket,
  vaciarTicket,
  type ItemTicket,
  type Lista,
} from './ticket.ts';
import { turnoActual } from './turno.ts';

export interface VentaHecha {
  id: string;
  creadaEn: string;
  items: ItemTicket[];
  total: number;
  lista?: Lista;
  medio: 'efectivo' | 'transferencia' | 'qr_mp';
  recibido?: number;
  vuelto?: number;
  confirmadoEn?: string;
}

/** Guarda la venta en la bandeja (se sube sola) y vacía el ticket. */
export async function cobrar(
  medio: 'efectivo' | 'transferencia',
  recibido?: number,
): Promise<VentaHecha> {
  const turno = turnoActual();
  if (!turno) throw new Error('Abrí la caja para vender.');
  const items = ticketActual();
  const total = totalTicket(items);
  if (!items.length || total <= 0) throw new Error('El ticket está vacío.');
  const lista = listaActual();
  const presupuesto = presupuestoActual();
  const venta: VentaHecha = {
    id: uuidv7(),
    creadaEn: new Date().toISOString(),
    items,
    total,
    lista,
    medio,
    ...(medio === 'efectivo' && recibido !== undefined
      ? { recibido, vuelto: recibido - total }
      : {}),
  };
  await encolar('venta', {
    id: venta.id,
    turnoId: turno.id,
    creadaEn: venta.creadaEn,
    total,
    ...(lista !== 'mostrador' ? { lista } : {}),
    ...(presupuesto ? { presupuestoId: presupuesto.id } : {}),
    items: items.map((i) => ({
      id: i.id,
      productoId: i.productoId,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
    })),
    pagos: [
      {
        id: uuidv7(),
        medio,
        monto: total,
        ...(medio === 'efectivo' && recibido !== undefined ? { recibido } : {}),
      },
    ],
  });
  vaciarTicket();
  return venta;
}
