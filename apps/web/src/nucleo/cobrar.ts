import { formatearPlata, uuidv7 } from '@mostrador/shared';
import { api } from './api.ts';
import { encolar, sincronizar } from './bandeja.ts';
import {
  cambioActual,
  compradorActual,
  cuentaTicket,
  listaActual,
  presupuestoActual,
  regaloActual,
  ticketActual,
  vaciarTicket,
  type Cuenta,
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
  /** Promos que se aplicaron (etapa I7). */
  descuentos?: { descripcion: string; monto: number }[];
  regalo?: boolean;
  /** Cambio: lo que devolvió el cliente. */
  cambio?: { codigo: string; items: { descripcion: string; cantidad: number; importe: number }[] };
}

/** Lo que la venta guarda de la cuenta del ticket para mostrar e imprimir. */
export function extrasDeVenta(
  cuenta: Cuenta,
): Pick<VentaHecha, 'descuentos' | 'regalo' | 'cambio'> {
  const cambio = cambioActual();
  return {
    ...(cuenta.descuentos.length
      ? {
          descuentos: cuenta.descuentos.map((d) => ({
            descripcion: d.descripcion,
            monto: d.monto,
          })),
        }
      : {}),
    ...(regaloActual() ? { regalo: true } : {}),
    ...(cambio ? { cambio: { codigo: cambio.codigo, items: cambio.items } } : {}),
  };
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
  const cuenta = cuentaTicket(items);
  const cambio = cambioActual();
  return {
    id,
    turnoId: turno.id,
    creadaEn,
    total: cuenta.total,
    ...(lista !== 'mostrador' ? { lista } : {}),
    ...(presupuesto ? { presupuestoId: presupuesto.id } : {}),
    ...(cuenta.descuentos.length
      ? { descuentos: cuenta.descuentos.map((d) => ({ promoId: d.promoId, monto: d.monto })) }
      : {}),
    ...(regaloActual() ? { regalo: true } : {}),
    ...(compradorActual() ? { compradorId: compradorActual()?.id } : {}),
    ...(cambio
      ? {
          cambio: {
            ventaId: cambio.ventaId,
            items: cambio.items.map((x) => ({ itemId: x.itemId, cantidad: x.cantidad })),
          },
        }
      : {}),
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
  const cuenta = cuentaTicket(items);
  const total = cuenta.total;
  if (!items.length) throw new Error('El ticket está vacío.');
  if (total < 0)
    throw new Error('Lo que se lleva tiene que valer lo mismo o más que lo que devuelve.');
  // Sin plata de por medio solo un cambio por algo del mismo valor.
  if (total === 0 && !cambioActual()) throw new Error('El ticket está vacío.');
  // El total se vuelve a calcular acá (una promo pudo terminar a la medianoche).
  if (medio === 'efectivo' && recibido !== undefined && recibido < total)
    throw new Error(`Falta plata: el total quedó en ${formatearPlata(total)}.`);
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
    ...extrasDeVenta(cuenta),
  };
  await encolar(
    'venta',
    datosVenta(
      venta.id,
      venta.creadaEn,
      total > 0
        ? [
            {
              id: uuidv7(),
              medio,
              monto: total,
              ...(medio === 'efectivo' && recibido !== undefined ? { recibido } : {}),
            },
          ]
        : [],
    ),
  );
  vaciarTicket();
  return venta;
}

/**
 * Último intento de anotar a cuenta. Si se cortó la conexión después de que el servidor la
 * guardó, reintentar con el mismo ticket manda la misma venta (el servidor no la duplica).
 */
let intentoACuenta: {
  firma: string;
  id: string;
  pagoId: string;
  creadaEn: string;
} | null = null;

/**
 * Anota la venta en la cuenta del cliente. Necesita conexión: el servidor revisa el límite en el
 * momento, así nadie se lleva mercadería que después no se puede anotar.
 */
export async function cobrarACuenta(cliente: {
  id: string;
  nombre: string;
  telefono: string | null;
  /** Lo que debía antes: si no se puede preguntar el saldo nuevo, se calcula. */
  saldo?: number;
}): Promise<VentaHecha> {
  const items = ticketActual();
  const cuenta = cuentaTicket(items);
  const total = cuenta.total;
  if (!items.length || total <= 0) throw new Error('El ticket está vacío.');
  // Primero lo pendiente (por ejemplo, la apertura de la caja hecha sin internet).
  await sincronizar();
  const firma = JSON.stringify({ items, cliente: cliente.id, total });
  if (intentoACuenta?.firma !== firma)
    intentoACuenta = {
      firma,
      id: uuidv7(),
      pagoId: uuidv7(),
      creadaEn: new Date().toISOString(),
    };
  const { id, pagoId, creadaEn } = intentoACuenta;
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
            [{ id: pagoId, medio: 'cuenta_corriente', monto: total }],
            { clienteId: cliente.id },
          ),
        },
      ],
    },
  );
  const res = r.resultados[0];
  if (!res || res.estado === 'rechazada') throw new Error(res?.mensaje ?? 'No se pudo anotar.');
  intentoACuenta = null;
  const extras = extrasDeVenta(cuenta);
  // La venta ya quedó anotada: si no se puede preguntar el saldo, se muestra el calculado.
  const saldo = await api<{ saldo: number }>('GET', `/api/v1/clientes/${cliente.id}`)
    .then((r) => r.saldo)
    .catch(() => (cliente.saldo ?? 0) + total);
  vaciarTicket();
  return {
    id,
    creadaEn,
    items,
    total,
    lista,
    medio: 'cuenta_corriente',
    cliente: { ...cliente, saldo },
    ...extras,
  };
}
