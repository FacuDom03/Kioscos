// Cambios (etapa I7): el ticket de cambio lleva un código corto para encontrar la venta.
import { diaArgentino, importeDevuelto, sumarDias, type Unidad } from '@mostrador/shared';

/** Días para cambiar lo que se compró (lo que dice el ticket de cambio). */
export const DIAS_CAMBIO = 30;

/** Los últimos 8 caracteres del ID de la venta, en mayúsculas: "4F0C81A2". */
export const codigoDeCambio = (ventaId: string) => ventaId.slice(-8).toUpperCase();

export interface ItemCambiable {
  id: string;
  productoId: string | null;
  descripcion: string;
  cantidad: number;
  unidad: Unidad;
  precioUnitario: number;
  subtotal: number;
  /** Lo que ya se devolvió en cambios anteriores. */
  devuelto: number;
}

export interface VentaCambiable {
  id: string;
  codigo: string;
  creadaEn: string;
  total: number;
  regalo: boolean;
  suma: number;
  descuentos: number;
  items: ItemCambiable[];
}

/** Lo que vale devolver `cantidad` de un ítem: lo que se pagó, con su parte de las promos. */
export const valorDevuelto = (v: VentaCambiable, item: ItemCambiable, cantidad: number) =>
  importeDevuelto(item, cantidad, { suma: v.suma, descuentos: v.descuentos });

export const quedaParaCambiar = (item: ItemCambiable) =>
  Math.round((item.cantidad - item.devuelto) * 1000) / 1000;

/** Si ya pasaron los días para cambiar lo de esa venta. */
export const vencioElCambio = (creadaEn: string) =>
  sumarDias(diaArgentino(creadaEn), DIAS_CAMBIO) < diaArgentino();
