// Ticket en curso. Se guarda en el equipo: si se cierra la pestaña o se corta la luz, sigue ahí.
import { subtotal, uuidv7 } from '@mostrador/shared';
import { useSyncExternalStore } from 'react';
import { guardarClave, leerClave } from './local.ts';

export interface ItemTicket {
  id: string;
  productoId: string | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
}

let items: ItemTicket[] = [];
let kiosco: string | null = null;
const oyentes = new Set<() => void>();

function fijar(nuevos: ItemTicket[]) {
  items = nuevos;
  if (kiosco) void guardarClave(`ticket:${kiosco}`, items);
  for (const o of oyentes) o();
}

export async function cargarTicket(kioscoId: string): Promise<void> {
  kiosco = kioscoId;
  items = (await leerClave<ItemTicket[]>(`ticket:${kioscoId}`)) ?? [];
  for (const o of oyentes) o();
}

/** Sumar el mismo producto incrementa la cantidad, no agrega una línea nueva. */
export function sumarProducto(
  p: { id: string; nombre: string; precio: number },
  cantidad = 1,
): void {
  const i = items.findIndex((x) => x.productoId === p.id && x.precioUnitario === p.precio);
  if (i >= 0) fijar(items.map((x, j) => (j === i ? { ...x, cantidad: x.cantidad + cantidad } : x)));
  else
    fijar([
      ...items,
      { id: uuidv7(), productoId: p.id, descripcion: p.nombre, cantidad, precioUnitario: p.precio },
    ]);
}

export function sumarPrecioLibre(precio: number, descripcion: string, cantidad = 1): void {
  fijar([
    ...items,
    {
      id: uuidv7(),
      productoId: null,
      descripcion: descripcion || 'Producto sin código',
      cantidad,
      precioUnitario: precio,
    },
  ]);
}

export function cambiarCantidad(id: string, delta: number): void {
  fijar(
    items.flatMap((x) =>
      x.id !== id
        ? [x]
        : x.cantidad + delta <= 0
          ? []
          : [{ ...x, cantidad: Math.round((x.cantidad + delta) * 1000) / 1000 }],
    ),
  );
}

export function quitarItem(id: string): void {
  fijar(items.filter((x) => x.id !== id));
}

export function vaciarTicket(): void {
  fijar([]);
}

export const totalTicket = (xs: ItemTicket[]) =>
  xs.reduce((t, x) => t + subtotal(x.cantidad, x.precioUnitario), 0);
export const unidades = (xs: ItemTicket[]) =>
  xs.reduce((t, x) => t + (Number.isInteger(x.cantidad) ? x.cantidad : 1), 0);

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};
export const useTicket = () => useSyncExternalStore(suscribir, () => items);
export const ticketActual = () => items;
