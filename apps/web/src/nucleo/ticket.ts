// Ticket en curso. Se guarda en el equipo: si se cierra la pestaña o se corta la luz, sigue ahí.
import { formatearCantidad, subtotal, uuidv7, type Unidad } from '@mostrador/shared';
import { useSyncExternalStore } from 'react';
import { productoPorId } from './catalogo.ts';
import { guardarClave, leerClave } from './local.ts';

export interface ItemTicket {
  id: string;
  productoId: string | null;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  /** Unidad de venta del producto (metro, kilo...). Falta en tickets viejos: es "unidad". */
  unidad?: Unidad;
}

/** Lista de precios de la venta (etapa I2): mostrador o gremio. */
export type Lista = 'mostrador' | 'gremio';

interface ProductoVendible {
  id: string;
  nombre: string;
  precio: number;
  precioGremio?: number | null;
  unidad?: Unidad;
}

let items: ItemTicket[] = [];
let lista: Lista = 'mostrador';
let kiosco: string | null = null;
const oyentes = new Set<() => void>();

function avisar() {
  for (const o of oyentes) o();
}

function fijar(nuevos: ItemTicket[]) {
  items = nuevos;
  if (kiosco) void guardarClave(`ticket:${kiosco}`, items);
  avisar();
}

export async function cargarTicket(kioscoId: string): Promise<void> {
  kiosco = kioscoId;
  items = (await leerClave<ItemTicket[]>(`ticket:${kioscoId}`)) ?? [];
  lista = (await leerClave<Lista>(`lista:${kioscoId}`)) ?? 'mostrador';
  avisar();
}

/** Precio del producto en una lista. Sin precio de gremio, vale el de mostrador. */
export function precioEnLista(p: ProductoVendible, l: Lista = lista): number {
  return l === 'gremio' && p.precioGremio != null ? p.precioGremio : p.precio;
}

/** Cambia la lista de la venta y vuelve a poner los precios de lo que ya está en el ticket. */
export function fijarLista(nueva: Lista): void {
  lista = nueva;
  if (kiosco) void guardarClave(`lista:${kiosco}`, lista);
  fijar(
    items.map((x) => {
      const p = x.productoId ? productoPorId(x.productoId) : undefined;
      return p ? { ...x, precioUnitario: precioEnLista(p, nueva) } : x;
    }),
  );
}

export const listaActual = () => lista;

/** Sumar el mismo producto incrementa la cantidad, no agrega una línea nueva. */
export function sumarProducto(p: ProductoVendible, cantidad = 1): void {
  const precio = precioEnLista(p);
  const i = items.findIndex((x) => x.productoId === p.id && x.precioUnitario === precio);
  if (i >= 0)
    fijar(
      items.map((x, j) =>
        j === i ? { ...x, cantidad: Math.round((x.cantidad + cantidad) * 1000) / 1000 } : x,
      ),
    );
  else
    fijar([
      ...items,
      {
        id: uuidv7(),
        productoId: p.id,
        descripcion: p.nombre,
        cantidad,
        precioUnitario: precio,
        ...(p.unidad && p.unidad !== 'unidad' ? { unidad: p.unidad } : {}),
      },
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

/** Vacía el ticket. La venta que sigue arranca con la lista de mostrador. */
export function vaciarTicket(): void {
  lista = 'mostrador';
  if (kiosco) void guardarClave(`lista:${kiosco}`, lista);
  fijar([]);
}

export const totalTicket = (xs: ItemTicket[]) =>
  xs.reduce((t, x) => t + subtotal(x.cantidad, x.precioUnitario), 0);
/** "12,5 m" para lo que se vende fraccionado o por caja; "2×" para lo que va por unidad. */
export function cantidadEnTicket(x: Pick<ItemTicket, 'cantidad' | 'unidad'>): string {
  return x.unidad && x.unidad !== 'unidad'
    ? formatearCantidad(x.cantidad, x.unidad)
    : `${formatearCantidad(x.cantidad)}×`;
}

/** Cuántos productos hay: lo que se vende fraccionado cuenta como uno. */
export const unidades = (xs: ItemTicket[]) =>
  xs.reduce(
    (t, x) =>
      t + (Number.isInteger(x.cantidad) && (!x.unidad || x.unidad === 'caja') ? x.cantidad : 1),
    0,
  );

const suscribir = (o: () => void) => {
  oyentes.add(o);
  return () => oyentes.delete(o);
};
export const useTicket = () => useSyncExternalStore(suscribir, () => items);
export const useLista = () => useSyncExternalStore(suscribir, () => lista);
export const ticketActual = () => items;
