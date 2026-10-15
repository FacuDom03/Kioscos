-- Etapa I3: proveedores y actualización de precios con su lista. Ver docs/decisiones/009.
-- Tablas nuevas de negocio: RLS forzada, FK compuestas y permisos mínimos, como las demás.

set local role mostrador_owner;

create table proveedores (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 80),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);
create unique index proveedores_nombre_uq on proveedores (kiosco_id, lower(nombre)) where activo;

-- Código con el que cada proveedor lista el producto, y el último costo que pasó.
create table producto_proveedor (
  id uuid primary key,
  kiosco_id uuid not null,
  producto_id uuid not null,
  proveedor_id uuid not null,
  codigo text not null check (length(codigo) between 1 and 60),
  costo bigint check (costo >= 0),
  actualizado_en timestamptz not null default now(),
  unique (kiosco_id, id),
  unique (kiosco_id, proveedor_id, codigo),
  unique (kiosco_id, proveedor_id, producto_id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id),
  foreign key (kiosco_id, proveedor_id) references proveedores (kiosco_id, id)
);
create index producto_proveedor_producto_idx on producto_proveedor (kiosco_id, producto_id);

-- Cada lista aplicada: opciones y, por producto, los valores de antes y de después (para
-- revisar y para deshacer).
create table listas_proveedor (
  id uuid primary key,
  kiosco_id uuid not null,
  proveedor_id uuid not null,
  usuario_id uuid not null,
  archivo text check (length(archivo) <= 120),
  renglones integer not null check (renglones >= 0),
  opciones jsonb not null,
  detalle jsonb not null,
  deshecha_en timestamptz,
  deshecha_por uuid,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, proveedor_id) references proveedores (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id),
  foreign key (kiosco_id, deshecha_por) references membresias (kiosco_id, usuario_id)
);
create index listas_proveedor_fecha_idx on listas_proveedor (kiosco_id, created_at);

do $$
declare
  t text;
begin
  foreach t in array array['proveedores', 'producto_proveedor', 'listas_proveedor']
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

grant select, insert on proveedores to mostrador_app;
grant update (nombre, activo, updated_at) on proveedores to mostrador_app;
grant select, insert, delete on producto_proveedor to mostrador_app;
grant update (codigo, costo, actualizado_en) on producto_proveedor to mostrador_app;
grant select, insert on listas_proveedor to mostrador_app;
grant update (deshecha_en, deshecha_por) on listas_proveedor to mostrador_app;

-- Cuándo cambió el precio por última vez (para avisar de precios viejos). Lo mantiene la base.
alter table productos add column precio_actualizado_en timestamptz not null default now();

create function productos_marcar_precio() returns trigger
language plpgsql
as $$
begin
  if new.precio is distinct from old.precio or new.precio_gremio is distinct from old.precio_gremio then
    new.precio_actualizado_en := now();
  end if;
  return new;
end
$$;

create trigger productos_precio_actualizado
  before update on productos
  for each row execute function productos_marcar_precio();

reset role;

-- Borrar la cuenta también borra proveedores y listas (antes que los productos, por las FK).
grant select, delete on proveedores, producto_proveedor, listas_proveedor to mostrador_sistema;

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
  delete from listas_proveedor where kiosco_id = k;
  delete from producto_proveedor where kiosco_id = k;
  delete from proveedores where kiosco_id = k;
  delete from movimientos_stock where kiosco_id = k;
  delete from pagos where kiosco_id = k;
  delete from venta_items where kiosco_id = k;
  delete from ventas where kiosco_id = k;
  delete from gastos where kiosco_id = k;
  delete from turnos_caja where kiosco_id = k;
  delete from compra_items where kiosco_id = k;
  delete from compras where kiosco_id = k;
  delete from cambios_precio where kiosco_id = k;
  delete from codigos_barra where kiosco_id = k;
  delete from productos where kiosco_id = k;
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
