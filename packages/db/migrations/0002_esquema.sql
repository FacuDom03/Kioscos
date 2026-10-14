-- Modelo de datos de la V1 (sección 7 de docs/SPEC.md).
--
-- Convenciones:
-- * IDs uuid (UUIDv7 generado en la app; sin default en la base).
-- * Plata en centavos, bigint.
-- * Toda tabla de negocio lleva kiosco_id y una clave única (kiosco_id, id). Las claves foráneas
--   entre tablas de negocio son compuestas (kiosco_id, x_id), así una fila de un kiosco nunca
--   puede apuntar a una fila de otro (las FK no pasan por RLS). Las referencias a personas van
--   contra membresias (kiosco_id, usuario_id): solo puede figurar alguien del mismo kiosco.
--   Ver docs/decisiones/002.

set local role mostrador_owner;

-- ---------------------------------------------------------------------------
-- Kioscos, usuarios y acceso
-- ---------------------------------------------------------------------------

create table kioscos (
  id uuid primary key,
  nombre text not null check (length(nombre) between 1 and 120),
  cuit text check (cuit ~ '^[0-9]{11}$'),
  plan text not null check (plan in ('esencial', 'comercio')),
  estado_suscripcion text not null default 'prueba'
    check (estado_suscripcion in ('prueba', 'activa', 'vencida', 'suspendida', 'baja')),
  soporte_hasta timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table usuarios (
  id uuid primary key,
  email text not null,
  password_hash text,
  totp_secreto_cifrado bytea,
  totp_clave_version smallint,
  segundo_factor_activo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index usuarios_email_uq on usuarios (lower(email));

create table membresias (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  usuario_id uuid not null references usuarios (id),
  rol text not null check (rol in ('dueno', 'encargado', 'cajero')),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  unique (kiosco_id, usuario_id)
);
create index membresias_usuario_idx on membresias (usuario_id);

create table dispositivos (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 60),
  credencial_hash text not null,
  ultimo_uso timestamptz,
  revocado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);

create table pines (
  id uuid primary key,
  kiosco_id uuid not null,
  membresia_id uuid not null,
  pin_hash text not null,
  intentos_fallidos smallint not null default 0,
  bloqueado_hasta timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  unique (kiosco_id, membresia_id),
  foreign key (kiosco_id, membresia_id) references membresias (kiosco_id, id)
);

-- ---------------------------------------------------------------------------
-- Catálogo y stock
-- ---------------------------------------------------------------------------

create table categorias (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 60),
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);
create index categorias_kiosco_orden_idx on categorias (kiosco_id, orden);

create table productos (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  categoria_id uuid,
  nombre text not null check (length(nombre) between 1 and 120),
  precio bigint not null check (precio >= 0),
  costo bigint check (costo >= 0),
  stock_actual numeric(12, 3) not null default 0,
  stock_minimo numeric(12, 3) not null default 0 check (stock_minimo >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, categoria_id) references categorias (kiosco_id, id)
);
create index productos_kiosco_nombre_idx on productos (kiosco_id, nombre);
create index productos_kiosco_categoria_idx on productos (kiosco_id, categoria_id);

create table codigos_barra (
  id uuid primary key,
  kiosco_id uuid not null,
  producto_id uuid not null,
  codigo text not null check (codigo ~ '^[0-9A-Za-z\-\.]{1,48}$'),
  tipo text not null check (tipo in ('ean13', 'ean8', 'upca', 'upce', 'code128', 'interno')),
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  unique (kiosco_id, codigo),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id)
);
create index codigos_barra_producto_idx on codigos_barra (kiosco_id, producto_id);

create table compras (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  usuario_id uuid not null,
  total bigint not null check (total >= 0),
  nota text check (length(nota) <= 500),
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id)
);
create index compras_kiosco_fecha_idx on compras (kiosco_id, created_at);

create table compra_items (
  id uuid primary key,
  kiosco_id uuid not null,
  compra_id uuid not null,
  producto_id uuid not null,
  cantidad numeric(12, 3) not null check (cantidad > 0),
  costo_unitario bigint not null check (costo_unitario >= 0),
  subtotal bigint not null check (subtotal >= 0),
  unique (kiosco_id, id),
  foreign key (kiosco_id, compra_id) references compras (kiosco_id, id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id)
);
create index compra_items_compra_idx on compra_items (kiosco_id, compra_id);

create table cambios_precio (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  usuario_id uuid not null,
  alcance text not null check (alcance in ('todo', 'categoria', 'seleccion')),
  categoria_id uuid,
  porcentaje numeric(6, 2) not null,
  redondeo bigint not null check (redondeo in (1000, 5000, 10000)),
  -- Precios anteriores y nuevos por producto, para la vista previa y para deshacer.
  detalle jsonb not null,
  deshecho_en timestamptz,
  deshecho_por uuid,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, categoria_id) references categorias (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id),
  foreign key (kiosco_id, deshecho_por) references membresias (kiosco_id, usuario_id)
);

-- ---------------------------------------------------------------------------
-- Caja y ventas
-- ---------------------------------------------------------------------------

create table cajas (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null default 'Caja',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);

create table turnos_caja (
  id uuid primary key,
  kiosco_id uuid not null,
  caja_id uuid not null,
  abierto_por uuid not null,
  cerrado_por uuid,
  abierto_en timestamptz not null default now(),
  cerrado_en timestamptz,
  cambio_inicial bigint not null check (cambio_inicial >= 0),
  esperado bigint,
  contado bigint check (contado >= 0),
  diferencia bigint,
  nota text check (length(nota) <= 500),
  unique (kiosco_id, id),
  foreign key (kiosco_id, caja_id) references cajas (kiosco_id, id),
  check ((cerrado_en is null) = (cerrado_por is null)),
  foreign key (kiosco_id, abierto_por) references membresias (kiosco_id, usuario_id),
  foreign key (kiosco_id, cerrado_por) references membresias (kiosco_id, usuario_id)
);
-- Un solo turno abierto por caja.
create unique index turnos_caja_abierto_uq on turnos_caja (kiosco_id, caja_id) where cerrado_en is null;

create table gastos (
  id uuid primary key,
  kiosco_id uuid not null,
  turno_id uuid not null,
  usuario_id uuid not null,
  tipo text not null check (tipo in ('gasto', 'retiro')),
  monto bigint not null check (monto > 0),
  motivo text not null check (length(motivo) between 1 and 200),
  creado_en_dispositivo timestamptz,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, turno_id) references turnos_caja (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id)
);
create index gastos_turno_idx on gastos (kiosco_id, turno_id);

create table ventas (
  -- El id lo genera el dispositivo: es la clave de idempotencia de la venta.
  id uuid primary key,
  kiosco_id uuid not null,
  turno_id uuid not null,
  usuario_id uuid not null,
  dispositivo_id uuid,
  total bigint not null check (total >= 0),
  estado text not null
    check (estado in ('abierta', 'cobrada', 'pendiente_cobro', 'anulada')),
  devolucion_pendiente boolean not null default false,
  anulada_por uuid,
  anulada_en timestamptz,
  motivo_anulacion text check (length(motivo_anulacion) <= 200),
  creada_en_dispositivo timestamptz not null,
  recibida_en timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, turno_id) references turnos_caja (kiosco_id, id),
  foreign key (kiosco_id, dispositivo_id) references dispositivos (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id),
  foreign key (kiosco_id, anulada_por) references membresias (kiosco_id, usuario_id)
);
create index ventas_kiosco_fecha_idx on ventas (kiosco_id, creada_en_dispositivo);
create index ventas_turno_idx on ventas (kiosco_id, turno_id);

create table venta_items (
  id uuid primary key,
  kiosco_id uuid not null,
  venta_id uuid not null,
  -- null en "producto sin código" (precio libre).
  producto_id uuid,
  descripcion text not null check (length(descripcion) between 1 and 120),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  precio_unitario bigint not null check (precio_unitario >= 0),
  subtotal bigint not null check (subtotal >= 0),
  unique (kiosco_id, id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id)
);
create index venta_items_venta_idx on venta_items (kiosco_id, venta_id);

create table pagos (
  id uuid primary key,
  kiosco_id uuid not null,
  venta_id uuid not null,
  medio text not null check (medio in ('efectivo', 'qr_mp', 'transferencia')),
  monto bigint not null check (monto > 0),
  recibido bigint check (recibido >= 0),
  vuelto bigint check (vuelto >= 0),
  estado text not null
    check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado', 'vencido', 'devuelto')),
  mp_order_id text,
  mp_payment_id text,
  confirmado_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id)
);
create index pagos_venta_idx on pagos (kiosco_id, venta_id);
create unique index pagos_mp_order_uq on pagos (kiosco_id, mp_order_id) where mp_order_id is not null;

create table movimientos_stock (
  id uuid primary key,
  kiosco_id uuid not null,
  producto_id uuid not null,
  tipo text not null check (tipo in ('venta', 'compra', 'ajuste', 'anulacion')),
  cantidad numeric(12, 3) not null check (cantidad <> 0),
  costo_unitario bigint check (costo_unitario >= 0),
  motivo text check (length(motivo) <= 200),
  -- Referencia a la venta, compra o ajuste que lo originó.
  venta_id uuid,
  compra_id uuid,
  usuario_id uuid,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id),
  foreign key (kiosco_id, compra_id) references compras (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id)
);
create index movimientos_stock_producto_idx on movimientos_stock (kiosco_id, producto_id, created_at);

-- ---------------------------------------------------------------------------
-- Integraciones y auditoría
-- ---------------------------------------------------------------------------

create table integraciones (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  proveedor text not null check (proveedor in ('mercadopago')),
  estado text not null check (estado in ('conectado', 'requiere_atencion', 'desconectado')),
  mp_user_id text,
  -- Tokens cifrados con libsodium (crypto_secretbox); la clave vive fuera de la base.
  access_token_cifrado bytea,
  refresh_token_cifrado bytea,
  clave_version smallint,
  vence_en timestamptz,
  mp_sucursal_id text,
  mp_caja_id text,
  mp_external_pos_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  unique (kiosco_id, proveedor)
);

create table auditoria (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  usuario_id uuid references usuarios (id),
  -- true si la acción la hizo soporte con el acceso temporal activo.
  es_soporte boolean not null default false,
  accion text not null check (length(accion) between 1 and 80),
  detalle jsonb,
  ip inet,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id)
);
create index auditoria_kiosco_fecha_idx on auditoria (kiosco_id, created_at);

-- Eventos de webhooks de Mercado Pago. Llegan antes de saber de qué kiosco son, por eso esta
-- tabla no es de un kiosco. Solo guarda el ID del evento y el resultado; nunca datos del pago.
create table eventos_webhook (
  id uuid primary key,
  proveedor text not null check (proveedor in ('mercadopago')),
  evento_id text not null,
  recibido_en timestamptz not null default now(),
  procesado_en timestamptz,
  resultado text check (length(resultado) <= 200),
  unique (proveedor, evento_id)
);
