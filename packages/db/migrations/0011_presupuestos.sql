-- Etapa I4: presupuestos (y remitos, que no se guardan: se imprimen desde la venta).
-- Ver docs/decisiones/009-rubros.md.

set local role mostrador_owner;

create table presupuestos (
  -- El ID lo genera el equipo: guardar dos veces el mismo presupuesto no lo duplica.
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  -- Número para mostrarle al cliente ("Presupuesto 12"). No se usa en URLs.
  numero integer not null check (numero > 0),
  usuario_id uuid not null,
  lista text not null default 'mostrador' check (lista in ('mostrador', 'gremio')),
  -- Para quién es (texto libre, opcional). Entra en la exportación y en el borrado de la cuenta.
  para text check (length(para) between 1 and 80),
  nota text check (length(nota) between 1 and 300),
  total bigint not null check (total >= 0),
  estado text not null default 'abierto' check (estado in ('abierto', 'vendido', 'anulado')),
  vence_en date not null,
  venta_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  unique (kiosco_id, numero),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id)
);
create index presupuestos_kiosco_fecha_idx on presupuestos (kiosco_id, created_at);

create table presupuesto_items (
  id uuid primary key,
  kiosco_id uuid not null,
  presupuesto_id uuid not null,
  producto_id uuid,
  descripcion text not null check (length(descripcion) between 1 and 120),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  unidad text not null default 'unidad'
    check (unidad in ('unidad', 'metro', 'kilo', 'litro', 'caja')),
  precio_unitario bigint not null check (precio_unitario >= 0),
  subtotal bigint not null check (subtotal >= 0),
  unique (kiosco_id, id),
  foreign key (kiosco_id, presupuesto_id) references presupuestos (kiosco_id, id),
  foreign key (kiosco_id, producto_id) references productos (kiosco_id, id)
);
create index presupuesto_items_presupuesto_idx on presupuesto_items (kiosco_id, presupuesto_id);

do $$
declare
  t text;
begin
  foreach t in array array['presupuestos', 'presupuesto_items']
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

grant select, insert on presupuestos to mostrador_app;
grant update (estado, venta_id, updated_at) on presupuestos to mostrador_app;
grant select, insert on presupuesto_items to mostrador_app;

-- Un presupuesto pasado a una venta con QR queda vendido recién cuando se cobra.
create function ventas_cerrar_presupuesto() returns trigger
language plpgsql
as $$
begin
  if new.estado = 'cobrada' and old.estado is distinct from 'cobrada' then
    update presupuestos set estado = 'vendido', updated_at = now()
      where kiosco_id = new.kiosco_id and venta_id = new.id and estado = 'abierto';
  end if;
  return new;
end
$$;

create trigger ventas_presupuesto_cobrado
  after update of estado on ventas
  for each row execute function ventas_cerrar_presupuesto();

reset role;

grant select, delete on presupuestos, presupuesto_items to mostrador_sistema;

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
  delete from presupuesto_items where kiosco_id = k;
  delete from presupuestos where kiosco_id = k;
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
