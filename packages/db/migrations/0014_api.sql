-- API para los comercios: claves de acceso de solo lectura y avisos automáticos (webhooks), para
-- conectar el negocio con n8n, Make, Zapier y similares. Ver docs/API.md.
--
-- OK del dueño del proyecto (octubre de 2026): lectura más avisos; los clientes de cuenta
-- corriente solo con un permiso aparte, auditado.

set local role mostrador_owner;

create table claves_api (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 60),
  -- El comienzo de la clave, para reconocerla en la lista. La clave entera no se guarda.
  prefijo text not null check (prefijo ~ '^mst_[A-Za-z0-9_-]{6}$'),
  token_hash text not null unique,
  -- Además de leer el negocio. Por ahora el único permiso extra es 'clientes'.
  permisos text[] not null default '{}' check (permisos <@ array['clientes']::text[]),
  creada_por uuid not null,
  ultimo_uso timestamptz,
  revocada_en timestamptz,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, creada_por) references membresias (kiosco_id, usuario_id)
);
create index claves_api_kiosco_idx on claves_api (kiosco_id, created_at);

create table webhooks (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  url text not null check (url ~ '^https://' and length(url) <= 500),
  eventos text[] not null check (
    cardinality(eventos) > 0
    and eventos <@ array['venta.creada', 'venta.anulada', 'compra.creada', 'stock.bajo']::text[]
  ),
  -- Con este secreto se firman los avisos. Cifrado con la clave maestra, fuera de la base.
  secreto_cifrado bytea not null,
  clave_version smallint not null,
  activo boolean not null default true,
  ultimo_envio timestamptz,
  ultimo_estado text check (length(ultimo_estado) <= 120),
  fallos_seguidos integer not null default 0,
  creado_por uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, creado_por) references membresias (kiosco_id, usuario_id)
);
create index webhooks_kiosco_idx on webhooks (kiosco_id) where activo;

do $$
declare
  t text;
begin
  foreach t in array array['claves_api', 'webhooks']
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

-- La API nunca lee el hash de una clave: las claves se reconocen con auth_clave_api.
grant select (id, kiosco_id, nombre, prefijo, permisos, creada_por, ultimo_uso, revocada_en, created_at)
  on claves_api to mostrador_app;
grant insert on claves_api to mostrador_app;
grant update (revocada_en) on claves_api to mostrador_app;
grant select, insert, delete on webhooks to mostrador_app;
grant update (activo, ultimo_envio, ultimo_estado, fallos_seguidos, updated_at) on webhooks
  to mostrador_app;

reset role;

grant select, update, delete on claves_api to mostrador_sistema;
grant select, delete on webhooks to mostrador_sistema;

set local role mostrador_sistema;

-- Reconoce una clave de API por su hash. Vale si no fue revocada, el comercio sigue activo y
-- quien la creó sigue siendo dueño. Anota el último uso (a lo sumo una vez por minuto).
create function auth_clave_api(p_token_hash text)
returns table (clave_id uuid, kiosco_id uuid, permisos text[])
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  c claves_api%rowtype;
begin
  select * into c from claves_api where token_hash = p_token_hash and revocada_en is null;
  if not found then
    return;
  end if;
  if not exists (
    select 1 from membresias m join kioscos k on k.id = m.kiosco_id
    where m.kiosco_id = c.kiosco_id and m.usuario_id = c.creada_por and m.rol = 'dueno'
      and m.activa and k.estado_suscripcion <> 'baja'
  ) then
    return;
  end if;
  if c.ultimo_uso is null or c.ultimo_uso < now() - interval '1 minute' then
    update claves_api set ultimo_uso = now() where id = c.id;
  end if;
  return query select c.id, c.kiosco_id, c.permisos;
end
$$;

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
  delete from webhooks where kiosco_id = k;
  delete from claves_api where kiosco_id = k;
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

revoke all on function auth_clave_api(text) from public;
grant execute on function auth_clave_api(text) to mostrador_app;
