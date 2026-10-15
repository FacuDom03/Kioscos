// Presupuestos (etapa I4): guardar el ticket, armar el texto para WhatsApp y pasarlo a venta.
import { formatearCantidad, formatearPlata, uuidv7, type Unidad } from '@mostrador/shared';
import { api } from './api.ts';
import { productoPorId } from './catalogo.ts';
import {
  cargarPresupuesto,
  listaActual,
  precioEnLista,
  ticketActual,
  totalTicket,
  vaciarTicket,
  type Lista,
} from './ticket.ts';

export interface ItemPresupuesto {
  id: string;
  productoId: string | null;
  descripcion: string;
  cantidad: number;
  unidad: Unidad;
  precioUnitario: number;
  subtotal: number;
}

export type EstadoPresupuesto = 'abierto' | 'vencido' | 'vendido' | 'anulado';

export interface Presupuesto {
  id: string;
  numero: number;
  lista: Lista;
  para: string | null;
  nota: string | null;
  total: number;
  estado: EstadoPresupuesto;
  venceEn: string;
  ventaId: string | null;
  creadoEn: string;
  hechoPor: string | null;
  items: ItemPresupuesto[];
}

export const ESTADOS: Record<EstadoPresupuesto, string> = {
  abierto: 'Abierto',
  vencido: 'Vencido',
  vendido: 'Vendido',
  anulado: 'Anulado',
};

/** "2026-10-30" → "30/10/2026". */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

/** Fecha de dentro de `dias` días, en la Argentina (AAAA-MM-DD). */
export function enDias(dias: number): string {
  return new Date(Date.now() + dias * 24 * 3600_000).toLocaleDateString('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

const cantidad = (i: { cantidad: number; unidad: Unidad }) =>
  i.unidad === 'unidad'
    ? `${formatearCantidad(i.cantidad)} ×`
    : formatearCantidad(i.cantidad, i.unidad);

/** Texto para mandar por WhatsApp (sin datos de nadie más que lo que se escribió en "para"). */
export function textoWhatsApp(p: Presupuesto, comercio: string): string {
  return [
    `*Presupuesto ${p.numero}* · ${comercio}`,
    ...(p.para ? [`Para: ${p.para}`] : []),
    '',
    ...p.items.map((i) => `${cantidad(i)} ${i.descripcion}: ${formatearPlata(i.subtotal)}`),
    '',
    `*Total: ${formatearPlata(p.total)}*`,
    ...(p.lista === 'gremio' ? ['Precios de gremio.'] : []),
    `Vale hasta el ${fechaCorta(p.venceEn)}.`,
    ...(p.nota ? [p.nota] : []),
  ].join('\n');
}

export const enlaceWhatsApp = (texto: string) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

/** Guarda lo que hay en el ticket como presupuesto y vacía el ticket. */
export async function guardarPresupuesto(datos: {
  para?: string;
  nota?: string;
  venceEn: string;
}): Promise<{ id: string; numero: number }> {
  const items = ticketActual();
  if (!items.length) throw new Error('El ticket está vacío.');
  const lista = listaActual();
  const r = await api<{ id: string; numero: number }>('POST', '/api/v1/presupuestos', {
    id: uuidv7(),
    ...(lista !== 'mostrador' ? { lista } : {}),
    ...(datos.para ? { para: datos.para } : {}),
    ...(datos.nota ? { nota: datos.nota } : {}),
    venceEn: datos.venceEn,
    total: totalTicket(items),
    items: items.map((i) => ({
      productoId: i.productoId,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      ...(i.unidad ? { unidad: i.unidad } : {}),
      precioUnitario: i.precioUnitario,
    })),
  });
  vaciarTicket();
  return r;
}

/**
 * Pone el presupuesto en el ticket para cobrarlo, con los precios que se le pasaron o con los de
 * hoy (los productos que ya no están en el catálogo quedan con el precio del presupuesto).
 */
export function venderPresupuesto(p: Presupuesto, preciosDeHoy: boolean): void {
  cargarPresupuesto(
    p,
    p.items.map((i) => {
      const producto = i.productoId ? productoPorId(i.productoId) : undefined;
      return {
        productoId: producto ? i.productoId : null,
        descripcion: i.descripcion,
        cantidad: i.cantidad,
        precioUnitario:
          preciosDeHoy && producto ? precioEnLista(producto, p.lista) : i.precioUnitario,
        ...(i.unidad !== 'unidad' ? { unidad: i.unidad } : {}),
      };
    }),
  );
}
