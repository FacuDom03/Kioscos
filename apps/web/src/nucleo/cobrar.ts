import { uuidv7 } from '@mostrador/shared';
import { api } from './api.ts';
import { encolar, sincronizar } from './bandeja.ts';
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
  medio: 'efectivo' | 'transferencia' | 'qr_mp' | 'cuenta_corriente';
  recibido?: number;
  vuelto?: number;
  confirmadoEn?: string;
  /** Venta a cuenta: a quién y cuánto debe ahora. */
  cliente?: { id: string; nombre: string; telefono: string | null; saldo: number };
}

/** Lo que va a la bandeja (o directo al servidor) para registrar la venta del ticket. */
function datosVenta(
  id: string,
  creadaEn: string,
  pagos: { id: string; medio: string; monto: number; recibido?: number }[],
  extra: Record<string, unknown> = {},
) {
  const turno = turnoActual();
  if (!turno) throw new Error('Abrí la caja para vender.');
  const items = ticketActual();
  const lista = listaActual();
  const presupuesto = presupuestoActual();
  return {
    id,
    turnoId: turno.id,
    creadaEn,
    total: totalTicket(items),
    ...(lista !== 'mostrador' ? { lista } : {}),
    ...(presupuesto ? { presupuestoId: presupuesto.id } : {}),
    ...extra,
    items: items.map((i) => ({
      id: i.id,
      productoId: i.productoId,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      precioUnitario: i.precioUnitario,
    })),
    pagos,
  };
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
  await encolar(
    'venta',
    datosVenta(venta.id, venta.creadaEn, [
      {
        id: uuidv7(),
        medio,
        monto: total,
        ...(medio === 'efectivo' && recibido !== undefined ? { recibido } : {}),
      },
    ]),
  );
  vaciarTicket();
  return venta;
}

/**
 * Anota la venta en la cuenta del cliente. Necesita conexión: el servidor revisa el límite en el
 * momento, así nadie se lleva mercadería que después no se puede anotar.
 */
export async function cobrarACuenta(cliente: {
  id: string;
  nombre: string;
  telefono: string | null;
}): Promise<VentaHecha> {
  const items = ticketActual();
  const total = totalTicket(items);
  if (!items.length || total <= 0) throw new Error('El ticket está vacío.');
  // Primero lo pendiente (por ejemplo, la apertura de la caja hecha sin internet).
  await sincronizar();
  const id = uuidv7();
  const creadaEn = new Date().toISOString();
  const lista = listaActual();
  const r = await api<{ resultados: { estado: string; mensaje?: string }[] }>(
    'POST',
    '/api/v1/sync',
    {
      ops: [
        {
          tipo: 'venta',
          datos: datosVenta(
            id,
            creadaEn,
            [{ id: uuidv7(), medio: 'cuenta_corriente', monto: total }],
            { clienteId: cliente.id },
          ),
        },
      ],
    },
  );
  const res = r.resultados[0];
  if (!res || res.estado === 'rechazada') throw new Error(res?.mensaje ?? 'No se pudo anotar.');
  const { saldo } = await api<{ saldo: number }>('GET', `/api/v1/clientes/${cliente.id}`);
  vaciarTicket();
  return {
    id,
    creadaEn,
    items,
    total,
    lista,
    medio: 'cuenta_corriente',
    cliente: { ...cliente, saldo },
  };
}
