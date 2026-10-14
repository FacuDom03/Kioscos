// Tipos de las tablas para Kysely. Mantener en sincronía con migrations/.
// bigint llega como number (ver conexion.ts); numeric llega como string.
import type { ColumnType, Generated } from 'kysely';

type Fecha = ColumnType<Date, Date | string, Date | string>;
type FechaDefault = ColumnType<Date, Date | string | undefined, Date | string>;
type Numerico = ColumnType<string, string | number, string | number>;
type NumericoDefault = ColumnType<string, string | number | undefined, string | number>;
type Json = ColumnType<unknown, string, string>;

export type Rol = 'dueno' | 'encargado' | 'cajero';

export interface KioscosTabla {
  id: string;
  nombre: string;
  cuit: string | null;
  plan: 'esencial' | 'comercio';
  rubro: Generated<'kiosco' | 'almacen' | 'ferreteria' | 'perfumeria' | 'libreria' | 'otro'>;
  modulos: Generated<string[]>;
  configurado: Generated<boolean>;
  estado_suscripcion: Generated<'prueba' | 'activa' | 'vencida' | 'suspendida' | 'baja'>;
  soporte_hasta: Fecha | null;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface UsuariosTabla {
  id: string;
  email: string | null;
  nombre: Generated<string>;
  intentos_fallidos: Generated<number>;
  bloqueado_hasta: Fecha | null;
  codigos_recuperacion: Generated<string[]>;
  password_hash: string | null;
  totp_secreto_cifrado: Buffer | null;
  totp_clave_version: number | null;
  segundo_factor_activo: Generated<boolean>;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface MembresiasTabla {
  id: string;
  kiosco_id: string;
  usuario_id: string;
  rol: Rol;
  activa: Generated<boolean>;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface DispositivosTabla {
  id: string;
  kiosco_id: string;
  nombre: string;
  credencial_hash: string;
  ultimo_uso: Fecha | null;
  revocado_en: Fecha | null;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface PinesTabla {
  id: string;
  kiosco_id: string;
  membresia_id: string;
  pin_hash: string;
  intentos_fallidos: Generated<number>;
  bloqueado_hasta: Fecha | null;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface CategoriasTabla {
  id: string;
  kiosco_id: string;
  nombre: string;
  orden: Generated<number>;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface ProductosTabla {
  id: string;
  kiosco_id: string;
  categoria_id: string | null;
  nombre: string;
  precio: number;
  costo: number | null;
  stock_actual: NumericoDefault;
  stock_minimo: NumericoDefault;
  activo: Generated<boolean>;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface CodigosBarraTabla {
  id: string;
  kiosco_id: string;
  producto_id: string;
  codigo: string;
  tipo: 'ean13' | 'ean8' | 'upca' | 'upce' | 'code128' | 'interno';
  created_at: FechaDefault;
}

export interface ComprasTabla {
  id: string;
  kiosco_id: string;
  usuario_id: string;
  total: number;
  nota: string | null;
  created_at: FechaDefault;
}

export interface CompraItemsTabla {
  id: string;
  kiosco_id: string;
  compra_id: string;
  producto_id: string;
  cantidad: Numerico;
  costo_unitario: number;
  subtotal: number;
}

export interface CambiosPrecioTabla {
  id: string;
  kiosco_id: string;
  usuario_id: string;
  alcance: 'todo' | 'categoria' | 'seleccion';
  categoria_id: string | null;
  porcentaje: Numerico;
  redondeo: 1000 | 5000 | 10000;
  detalle: Json;
  deshecho_en: Fecha | null;
  deshecho_por: string | null;
  created_at: FechaDefault;
}

export interface CajasTabla {
  id: string;
  kiosco_id: string;
  nombre: Generated<string>;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface TurnosCajaTabla {
  id: string;
  kiosco_id: string;
  caja_id: string;
  abierto_por: string;
  cerrado_por: string | null;
  abierto_en: FechaDefault;
  cerrado_en: Fecha | null;
  cambio_inicial: number;
  esperado: number | null;
  contado: number | null;
  diferencia: number | null;
  nota: string | null;
}

export interface GastosTabla {
  id: string;
  kiosco_id: string;
  turno_id: string;
  usuario_id: string;
  tipo: 'gasto' | 'retiro';
  monto: number;
  motivo: string;
  creado_en_dispositivo: Fecha | null;
  created_at: FechaDefault;
}

export interface VentasTabla {
  id: string;
  kiosco_id: string;
  turno_id: string;
  usuario_id: string;
  dispositivo_id: string | null;
  total: number;
  estado: 'abierta' | 'cobrada' | 'pendiente_cobro' | 'anulada';
  devolucion_pendiente: Generated<boolean>;
  anulada_por: string | null;
  anulada_en: Fecha | null;
  motivo_anulacion: string | null;
  creada_en_dispositivo: Fecha;
  recibida_en: FechaDefault;
}

export interface VentaItemsTabla {
  id: string;
  kiosco_id: string;
  venta_id: string;
  producto_id: string | null;
  descripcion: string;
  cantidad: Numerico;
  precio_unitario: number;
  subtotal: number;
}

export interface PagosTabla {
  id: string;
  kiosco_id: string;
  venta_id: string;
  medio: 'efectivo' | 'qr_mp' | 'transferencia';
  monto: number;
  recibido: number | null;
  vuelto: number | null;
  estado: 'pendiente' | 'aprobado' | 'rechazado' | 'cancelado' | 'vencido' | 'devuelto';
  mp_order_id: string | null;
  mp_payment_id: string | null;
  confirmado_en: Fecha | null;
  vence_en: Fecha | null;
  ultima_consulta: Fecha | null;
  mp_qr_data: string | null;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface MovimientosStockTabla {
  id: string;
  kiosco_id: string;
  producto_id: string;
  tipo: 'venta' | 'compra' | 'ajuste' | 'anulacion';
  cantidad: Numerico;
  costo_unitario: number | null;
  motivo: string | null;
  venta_id: string | null;
  compra_id: string | null;
  usuario_id: string | null;
  created_at: FechaDefault;
}

export interface IntegracionesTabla {
  id: string;
  kiosco_id: string;
  proveedor: 'mercadopago';
  estado: 'conectado' | 'requiere_atencion' | 'desconectado';
  mp_user_id: string | null;
  access_token_cifrado: Buffer | null;
  refresh_token_cifrado: Buffer | null;
  clave_version: number | null;
  vence_en: Fecha | null;
  mp_sucursal_id: string | null;
  mp_caja_id: string | null;
  mp_external_pos_id: string | null;
  created_at: FechaDefault;
  updated_at: FechaDefault;
}

export interface AuditoriaTabla {
  id: string;
  kiosco_id: string;
  usuario_id: string | null;
  es_soporte: Generated<boolean>;
  accion: string;
  detalle: Json | null;
  ip: string | null;
  created_at: FechaDefault;
}

export interface InvitacionesTabla {
  id: string;
  kiosco_id: string;
  email: string;
  rol: 'dueno' | 'encargado';
  token_hash: string;
  vence_en: Fecha;
  usada_en: Fecha | null;
  creada_por: string | null;
  created_at: FechaDefault;
}

export interface OauthEstadosTabla {
  id: string;
  kiosco_id: string;
  usuario_id: string;
  state_hash: string;
  verificador_cifrado: Buffer;
  clave_version: number;
  vence_en: Fecha;
  usado_en: Fecha | null;
  created_at: FechaDefault;
}

export interface EventosWebhookTabla {
  id: string;
  proveedor: 'mercadopago';
  evento_id: string;
  recibido_en: FechaDefault;
  procesado_en: Fecha | null;
  resultado: string | null;
}

export interface Database {
  kioscos: KioscosTabla;
  usuarios: UsuariosTabla;
  membresias: MembresiasTabla;
  dispositivos: DispositivosTabla;
  pines: PinesTabla;
  categorias: CategoriasTabla;
  productos: ProductosTabla;
  codigos_barra: CodigosBarraTabla;
  compras: ComprasTabla;
  compra_items: CompraItemsTabla;
  cambios_precio: CambiosPrecioTabla;
  cajas: CajasTabla;
  turnos_caja: TurnosCajaTabla;
  gastos: GastosTabla;
  ventas: VentasTabla;
  venta_items: VentaItemsTabla;
  pagos: PagosTabla;
  movimientos_stock: MovimientosStockTabla;
  integraciones: IntegracionesTabla;
  auditoria: AuditoriaTabla;
  invitaciones: InvitacionesTabla;
  oauth_estados: OauthEstadosTabla;
  eventos_webhook: EventosWebhookTabla;
}

/** Tablas que pertenecen a un kiosco (todas salvo las globales). */
export const TABLAS_DE_KIOSCO = [
  'kioscos',
  'usuarios',
  'membresias',
  'dispositivos',
  'pines',
  'categorias',
  'productos',
  'codigos_barra',
  'compras',
  'compra_items',
  'cambios_precio',
  'cajas',
  'turnos_caja',
  'gastos',
  'ventas',
  'venta_items',
  'pagos',
  'movimientos_stock',
  'integraciones',
  'auditoria',
  'invitaciones',
  'oauth_estados',
] as const satisfies readonly (keyof Database)[];

/** Tablas sin kiosco: no tienen RLS y no guardan datos de negocio. */
export const TABLAS_GLOBALES = ['eventos_webhook'] as const satisfies readonly (keyof Database)[];

/**
 * Tablas solo de sistema (sesiones, passkeys, admins): RLS forzada sin políticas y sin ningún
 * permiso para la API. Se usan solo a través de las funciones auth_* y panel_*.
 */
export const TABLAS_SISTEMA = ['sesiones', 'passkeys', 'admins', 'sesiones_admin'] as const;
