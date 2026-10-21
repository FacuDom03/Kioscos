// Clientes y cuenta corriente / fiado (etapa I5).
import { formatearPlata } from '@mostrador/shared';

export interface ClienteResumen {
  id: string;
  nombre: string;
  telefono: string | null;
  nota: string | null;
  limite: number | null;
  saldo: number;
  ultimo: string | null;
  doc_tipo: 'cuit' | 'cuil' | 'dni' | null;
  doc_nro: string | null;
  condicion_iva: 'consumidor_final' | 'monotributo' | 'responsable_inscripto' | 'exento' | null;
  domicilio: string | null;
}

export interface MovimientoCuenta {
  id: string;
  tipo: 'venta' | 'pago' | 'anulacion' | 'ajuste';
  monto: number;
  medio: 'efectivo' | 'transferencia' | null;
  venta_id: string | null;
  nota: string | null;
  created_at: string;
  por: string | null;
}

export interface ClienteDetalle extends Omit<ClienteResumen, 'ultimo'> {
  activo: boolean;
  created_at: string;
  movimientos: MovimientoCuenta[];
}

export const TIPOS_MOVIMIENTO: Record<MovimientoCuenta['tipo'], string> = {
  venta: 'Compra',
  pago: 'Pago',
  anulacion: 'Venta anulada',
  ajuste: 'Ajuste',
};

/** "Debe $ 28.930", "Al día" o "$ 500 a favor". */
export function enPalabras(saldo: number): string {
  if (saldo > 0) return `Debe ${formatearPlata(saldo)}`;
  if (saldo < 0) return `${formatearPlata(-saldo)} a favor`;
  return 'Al día';
}

/**
 * Enlace de WhatsApp al número del cliente. Los celulares de la Argentina se escriben de muchas
 * formas: se arma el número internacional (54 9 + característica + número) como se puede.
 */
export function enlaceWhatsAppCliente(telefono: string | null, texto: string): string {
  let n = (telefono ?? '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = n.slice(1);
  if (n && !n.startsWith('54')) n = `549${n}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

export function textoCuenta(comercio: string, nombre: string, saldo: number, ultimo?: string) {
  return [
    `Hola ${nombre}, te escribimos de ${comercio}.`,
    ...(ultimo ? [ultimo] : []),
    saldo > 0
      ? `Tu cuenta queda en ${formatearPlata(saldo)}.`
      : saldo < 0
        ? `Tenés ${formatearPlata(-saldo)} a favor.`
        : 'Tu cuenta quedó al día.',
  ].join('\n');
}
