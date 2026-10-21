// Ticket en curso. Se guarda en el equipo: si se cierra la pestaña o se corta la luz, sigue ahí.
import {
  calcularPromos,
  diaArgentino,
  formatearCantidad,
  subtotal,
  uuidv7,
  type Descuento,
  type Unidad,
} from '@mostrador/shared';
import { useSyncExternalStore } from 'react';
import { catalogoActual, productoPorId } from './catalogo.ts';
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
/** Presupuesto que se está vendiendo (etapa I4), con su número para mostrarlo. */
let presupuesto: { id: string; numero: number } | null = null;

/** Cambio (etapa I7): lo que el cliente devuelve de una venta anterior, al precio que pagó. */
export interface CambioEnCurso {
  ventaId: string;
  codigo: string;
  items: { itemId: string; descripcion: string; cantidad: number; importe: number }[];
}
let cambio: CambioEnCurso | null = null;
/** Para regalo: sale con ticket de cambio. */
let regalo = false;
/**
 * A nombre de quién sale la factura de esta venta (cliente con CUIT o DNI). Sin esto, consumidor
 * final. Vive solo en memoria: en el equipo no se guardan datos de clientes.
 */
export interface CompradorElegido {
  id: string;
  nombre: string;
  documento: { tipo: 'cuit' | 'cuil' | 'dni'; numero: string };
  condicion: 'consumidor_final' | 'monotributo' | 'responsable_inscripto' | 'exento';
}
let comprador: CompradorElegido | null = null;
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
  presupuesto = (await leerClave<typeof presupuesto>(`presupuesto:${kioscoId}`)) ?? null;
  cambio = (await leerClave<CambioEnCurso>(`cambio:${kioscoId}`)) ?? null;
  regalo = (await leerClave<boolean>(`regalo:${kioscoId}`)) ?? false;
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

function fijarPresupuesto(p: typeof presupuesto) {
  presupuesto = p;
  if (kiosco) void guardarClave(`presupuesto:${kiosco}`, presupuesto);
}

/** Vacía el ticket. La venta que sigue arranca con la lista de mostrador, sin presupuesto ni cambio. */
export function vaciarTicket(): void {
  lista = 'mostrador';
  if (kiosco) void guardarClave(`lista:${kiosco}`, lista);
  fijarPresupuesto(null);
  fijarCambio(null);
  fijarRegalo(false);
  comprador = null;
  fijar([]);
}

export function fijarComprador(c: CompradorElegido | null): void {
  comprador = c;
  avisar();
}

export const compradorActual = () => comprador;

function fijarCambio(c: CambioEnCurso | null) {
  cambio = c;
  if (kiosco) void guardarClave(`cambio:${kiosco}`, cambio);
}

/** Arranca un cambio: lo devuelto se descuenta de lo que se lleve. */
export function iniciarCambio(c: CambioEnCurso): void {
  fijarCambio(c);
  // Un cambio no es para regalo (aunque la venta anterior del ticket lo fuera).
  fijarRegalo(false);
}

export function soltarCambio(): void {
  fijarCambio(null);
  avisar();
}

export const cambioActual = () => cambio;

export function fijarRegalo(valor: boolean): void {
  regalo = valor;
  if (kiosco) void guardarClave(`regalo:${kiosco}`, regalo);
  avisar();
}

export const regaloActual = () => regalo;

/** Pone en el ticket lo de un presupuesto, para cobrarlo. */
export function cargarPresupuesto(
  p: { id: string; numero: number; lista: Lista },
  nuevos: Omit<ItemTicket, 'id'>[],
): void {
  lista = p.lista;
  if (kiosco) void guardarClave(`lista:${kiosco}`, lista);
  fijarPresupuesto({ id: p.id, numero: p.numero });
  fijar(nuevos.map((x) => ({ ...x, id: uuidv7() })));
}

/** Deja de vender el presupuesto (el ticket queda como está). */
export function soltarPresupuesto(): void {
  fijarPresupuesto(null);
  avisar();
}

export const presupuestoActual = () => presupuesto;

export const totalTicket = (xs: ItemTicket[]) =>
  xs.reduce((t, x) => t + subtotal(x.cantidad, x.precioUnitario), 0);

export interface Cuenta {
  /** Lo que suman los productos. */
  suma: number;
  descuentos: Descuento[];
  /** Lo que el cliente devuelve en un cambio. */
  devuelto: number;
  /** Lo que se cobra. Negativo en un cambio por algo más barato (no se devuelve plata). */
  total: number;
}

/** La cuenta del ticket: productos, promos que corren hoy y lo devuelto en un cambio. */
export function cuentaTicket(xs: ItemTicket[] = items): Cuenta {
  const suma = totalTicket(xs);
  const promos = catalogoActual()?.promos ?? [];
  const descuentos = promos.length
    ? calcularPromos(
        xs.map((x) => {
          const p = x.productoId ? productoPorId(x.productoId) : undefined;
          return {
            productoId: x.productoId,
            cantidad: x.cantidad,
            precioUnitario: x.precioUnitario,
            categoriaId: p?.categoriaId ?? null,
            grupoId: p?.grupoId ?? null,
          };
        }),
        promos,
        diaArgentino(),
      )
    : [];
  const devuelto = cambio?.items.reduce((t, x) => t + x.importe, 0) ?? 0;
  return {
    suma,
    descuentos,
    devuelto,
    total: suma - descuentos.reduce((t, d) => t + d.monto, 0) - devuelto,
  };
}
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
export const usePresupuesto = () => useSyncExternalStore(suscribir, () => presupuesto);
export const useCambio = () => useSyncExternalStore(suscribir, () => cambio);
export const useRegalo = () => useSyncExternalStore(suscribir, () => regalo);
export const useComprador = () => useSyncExternalStore(suscribir, () => comprador);
export const ticketActual = () => items;
