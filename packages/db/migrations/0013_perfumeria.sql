-- Etapa I7 (perfumería). Ver docs/decisiones/009-rubros.md. Cambios compatibles: tablas y
-- columnas nuevas, opcionales.
--
-- Variantes: cada tono o tamaño es un producto con su stock, su código y su precio; el grupo los
-- junta para elegirlos en Vender.

set local role mostrador_owner;

create table grupos_variantes (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 120),
  tipo text not null default 'tono' check (tipo in ('tono', 'tamano', 'aroma', 'talle', 'otro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);

alter table grupos_variantes enable row level security;
alter table grupos_variantes force row level security;
create policy aislamiento_kiosco on grupos_variantes
  using (kiosco_id = app_kiosco_id())
  with check (kiosco_id = app_kiosco_id());

grant select, insert on grupos_variantes to mostrador_app;
grant update (nombre, tipo, updated_at) on grupos_variantes to mostrador_app;

alter table productos add column grupo_id uuid;
alter table productos add column variante text check (length(variante) between 1 and 60);
-- Color de muestra del tono (#rrggbb), para elegirlo de un vistazo.
alter table productos add column color text check (color ~ '^#[0-9a-f]{6}$');
alter table productos add constraint productos_grupo_fk
  foreign key (kiosco_id, grupo_id) references grupos_variantes (kiosco_id, id);
alter table productos add constraint productos_variante_ck check ((grupo_id is null) = (variante is null));
create index productos_grupo_idx on productos (kiosco_id, grupo_id) where grupo_id is not null;

grant update (grupo_id, variante, color) on productos to mostrador_app;

-- Promos automáticas. Cada `lleva` unidades, las `paga` más caras van a precio lleno y el resto
-- con `descuento` por ciento menos: 3x2 es lleva 3, paga 2, descuento 100; la segunda al 50% es
-- lleva 2, paga 1, descuento 50. La regla no se edita (las ventas sin conexión se validan con
-- ella): se termina con `hasta` o se apaga.
create table promos (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 80),
  lleva integer not null check (lleva between 2 and 12),
  paga integer not null check (paga >= 1 and paga < lleva),
  descuento integer not null check (descuento between 1 and 100),
  -- A qué se aplica: una categoría o un producto con variantes (todos sus tonos juntos).
  categoria_id uuid,
  grupo_id uuid,
  desde date,
  hasta date,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  check (num_nonnulls(categoria_id, grupo_id) = 1),
  check (hasta is null or desde is null or hasta >= desde),
  foreign key (kiosco_id, categoria_id) references categorias (kiosco_id, id),
  foreign key (kiosco_id, grupo_id) references grupos_variantes (kiosco_id, id)
);

-- Lo que la promo le descontó a una venta.
create table venta_descuentos (
  id uuid primary key,
  kiosco_id uuid not null,
  venta_id uuid not null,
  promo_id uuid not null,
  descripcion text not null check (length(descripcion) between 1 and 80),
  monto bigint not null check (monto > 0),
  unique (kiosco_id, id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id),
  foreign key (kiosco_id, promo_id) references promos (kiosco_id, id)
);
create index venta_descuentos_venta_idx on venta_descuentos (kiosco_id, venta_id);

-- Regalo: se envuelve y sale con ticket de cambio (sin precios).
alter table ventas add column regalo boolean not null default false;

-- Cambios: la venta nueva lleva lo que se lleva el cliente y descuenta lo que devuelve (al precio
-- que pagó). Lo devuelto vuelve al stock.
create table devoluciones (
  id uuid primary key,
  kiosco_id uuid not null,
  -- La venta del cambio.
  venta_id uuid not null,
  -- El ítem de la venta original que se devuelve.
  venta_item_id uuid not null,
  producto_id uuid,
  descripcion text not null check (length(descripcion) between 1 and 120),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  importe bigint not null check (importe >= 0),
  unique (kiosco_id, id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id),
  foreign key (kiosco_id, venta_item_id) references venta_items (kiosco_id, id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id)
);
create index devoluciones_venta_idx on devoluciones (kiosco_id, venta_id);
create index devoluciones_item_idx on devoluciones (kiosco_id, venta_item_id);

alter table movimientos_stock drop constraint movimientos_stock_tipo_check;
alter table movimientos_stock add constraint movimientos_stock_tipo_check
  check (tipo in ('venta', 'compra', 'ajuste', 'anulacion', 'devolucion'));

-- Vencimientos por lote: cuántas unidades entraron y cuándo vencen. Se marca retirado cuando ya
-- no queda nada de ese lote.
create table lotes (
  id uuid primary key,
  kiosco_id uuid not null,
  producto_id uuid not null,
  vence_en date not null,
  cantidad numeric(12, 3) not null check (cantidad > 0),
  retirado boolean not null default false,
  usuario_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id)
);
create index lotes_vence_idx on lotes (kiosco_id, vence_en) where not retirado;

do $$
declare
  t text;
begin
  foreach t in array array['promos', 'venta_descuentos', 'devoluciones', 'lotes']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aislamiento_kiosco on %I
         using (kiosco_id = app_kiosco_id())
         with check (kiosco_id = app_kiosco_id())',
      t
    );
  end loop;
end
$$;

grant select, insert on promos to mostrador_app;
grant update (nombre, hasta, activa, updated_at) on promos to mostrador_app;
grant select, insert on venta_descuentos, devoluciones to mostrador_app;
grant select, insert on lotes to mostrador_app;
grant update (retirado, updated_at) on lotes to mostrador_app;

reset role;

grant select, delete on grupos_variantes, promos, venta_descuentos, devoluciones, lotes to mostrador_sistema;

set local role mostrador_sistema;

create or replace function kiosco_borrar_datos(p_usuario uuid) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  k uuid := app_kiosco_id();
begin
  if k is null then
    raise exception 'sin_kiosco' using errcode = 'P0001';
  end if;
  if not exists (select 1 from membresias where kiosco_id = k and usuario_id = p_usuario and rol = 'dueno' and activa) then
    raise exception 'sin_permiso' using errcode = 'P0001';
  end if;
  delete from sesiones where kiosco_id = k;
  delete from oauth_estados where kiosco_id = k;
  delete from movimientos_cuenta where kiosco_id = k;
  delete from presupuesto_items where kiosco_id = k;
  delete from presupuestos where kiosco_id = k;
  delete from listas_proveedor where kiosco_id = k;
  delete from producto_proveedor where kiosco_id = k;
  delete from proveedores where kiosco_id = k;
  delete from lotes where kiosco_id = k;
  delete from devoluciones where kiosco_id = k;
  delete from venta_descuentos where kiosco_id = k;
  delete from promos where kiosco_id = k;
  delete from movimientos_stock where kiosco_id = k;
  delete from pagos where kiosco_id = k;
  delete from venta_items where kiosco_id = k;
  delete from ventas where kiosco_id = k;
  delete from clientes where kiosco_id = k;
  delete from gastos where kiosco_id = k;
  delete from turnos_caja where kiosco_id = k;
  delete from compra_items where kiosco_id = k;
  delete from compras where kiosco_id = k;
  delete from cambios_precio where kiosco_id = k;
  delete from codigos_barra where kiosco_id = k;
  delete from productos where kiosco_id = k;
  delete from grupos_variantes where kiosco_id = k;
  delete from categorias where kiosco_id = k;
  delete from integraciones where kiosco_id = k;
  delete from invitaciones where kiosco_id = k;
  delete from pines where kiosco_id = k;
  delete from dispositivos where kiosco_id = k;
  -- Personas: se borran los datos de quienes no tienen otro kiosco.
  update usuarios u
    set email = null, nombre = 'Persona borrada', password_hash = null, totp_secreto_cifrado = null,
        totp_clave_version = null, segundo_factor_activo = false, codigos_recuperacion = '{}'
    where u.id in (select usuario_id from membresias where kiosco_id = k)
      and not exists (select 1 from membresias m where m.usuario_id = u.id and m.kiosco_id <> k);
  delete from passkeys p where p.usuario_id in (select usuario_id from membresias where kiosco_id = k)
    and not exists (select 1 from membresias m where m.usuario_id = p.usuario_id and m.kiosco_id <> k);
  update membresias set activa = false where kiosco_id = k;
  update kioscos set nombre = 'Kiosco borrado', cuit = null, estado_suscripcion = 'baja', soporte_hasta = null, updated_at = now()
    where id = k;
  insert into auditoria (id, kiosco_id, usuario_id, accion) values (gen_random_uuid(), k, p_usuario, 'kiosco.borrado');
end
$$;

reset role;
