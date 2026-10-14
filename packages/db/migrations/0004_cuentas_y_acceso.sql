-- Etapa B: cuentas y acceso (secciones 3 y 9 de docs/SPEC.md).
-- Ver docs/decisiones/005-login-con-funciones-de-sistema.md.
--
-- El login necesita buscar personas y sesiones ANTES de saber el kiosco, y la RLS no lo deja
-- (falla cerrada). En vez de abrir las tablas, se crean funciones `security definer` chicas,
-- dueñas de un rol sin login que saltea RLS (`mostrador_sistema`). El rol de la API solo puede
-- ejecutar esas funciones; no tiene permisos sobre las tablas de sesiones, passkeys ni admins.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mostrador_sistema') then
    create role mostrador_sistema nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mostrador_panel') then
    create role mostrador_panel login;
  end if;
end
$$;
alter role mostrador_sistema nologin nosuperuser nocreatedb nocreaterole bypassrls;
alter role mostrador_panel nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
grant mostrador_sistema to current_user;
grant usage, create on schema public to mostrador_sistema;
grant usage on schema public to mostrador_panel;
do $$
begin
  execute format('grant connect on database %I to mostrador_panel', current_database());
end
$$;

set local role mostrador_owner;

-- ---------------------------------------------------------------------------
-- Cambios en usuarios: nombre visible, cajeros sin email, bloqueo por intentos.
-- ---------------------------------------------------------------------------

alter table usuarios alter column email drop not null;
alter table usuarios add column nombre text not null default '' check (length(nombre) <= 60);
alter table usuarios add column intentos_fallidos smallint not null default 0;
alter table usuarios add column bloqueado_hasta timestamptz;
-- Hashes (SHA-256) de los códigos de recuperación que quedan sin usar.
alter table usuarios add column codigos_recuperacion text[] not null default '{}';
drop index usuarios_email_uq;
create unique index usuarios_email_uq on usuarios (lower(email)) where email is not null;

grant update (nombre, codigos_recuperacion) on usuarios to mostrador_app;
grant execute on function app_kiosco_id() to mostrador_sistema;

create unique index dispositivos_credencial_uq on dispositivos (credencial_hash);

-- ---------------------------------------------------------------------------
-- Invitaciones (de un solo uso, vencen a las 72 horas)
-- ---------------------------------------------------------------------------

create table invitaciones (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  email text not null check (length(email) between 3 and 254),
  rol text not null check (rol in ('dueno', 'encargado')),
  token_hash text not null unique,
  vence_en timestamptz not null,
  usada_en timestamptz,
  creada_por uuid references usuarios (id),
  created_at timestamptz not null default now(),
  unique (kiosco_id, id)
);
alter table invitaciones enable row level security;
alter table invitaciones force row level security;
create policy aislamiento_kiosco on invitaciones
  using (kiosco_id = app_kiosco_id())
  with check (kiosco_id = app_kiosco_id());
grant select on invitaciones to mostrador_app;
grant update (vence_en) on invitaciones to mostrador_app;

-- ---------------------------------------------------------------------------
-- Tablas solo de sistema: RLS forzada sin políticas y sin permisos para la API.
-- ---------------------------------------------------------------------------

create table sesiones (
  id uuid primary key,
  token_hash text not null unique,
  usuario_id uuid not null references usuarios (id),
  kiosco_id uuid references kioscos (id),
  rol text check (rol in ('dueno', 'encargado', 'cajero', 'soporte')),
  dispositivo_id uuid references dispositivos (id),
  -- 'pendiente_2fa': pasó la contraseña y falta el segundo factor.
  tipo text not null check (tipo in ('completa', 'pendiente_2fa')),
  es_soporte boolean not null default false,
  creada_en timestamptz not null default now(),
  ultima_actividad timestamptz not null default now(),
  vence_en timestamptz not null,
  -- Segundos de inactividad tolerados (null = sin límite por inactividad).
  inactividad_seg integer,
  -- Desafío pendiente de WebAuthn para esta sesión (registro o login con passkey).
  desafio text
);
create index sesiones_usuario_idx on sesiones (usuario_id);

create table passkeys (
  id uuid primary key,
  usuario_id uuid not null references usuarios (id),
  credential_id text not null unique,
  clave_publica bytea not null,
  contador bigint not null default 0,
  transportes text[] not null default '{}',
  nombre text not null default 'Passkey' check (length(nombre) <= 60),
  created_at timestamptz not null default now()
);
create index passkeys_usuario_idx on passkeys (usuario_id);

create table admins (
  id uuid primary key,
  email text not null,
  password_hash text not null,
  totp_secreto_cifrado bytea not null,
  totp_clave_version smallint not null,
  intentos_fallidos smallint not null default 0,
  bloqueado_hasta timestamptz,
  created_at timestamptz not null default now()
);
create unique index admins_email_uq on admins (lower(email));

create table sesiones_admin (
  id uuid primary key,
  token_hash text not null unique,
  admin_id uuid not null references admins (id),
  tipo text not null check (tipo in ('completa', 'pendiente_2fa')),
  ultima_actividad timestamptz not null default now(),
  vence_en timestamptz not null
);

do $$
declare
  t text;
begin
  foreach t in array array['sesiones', 'passkeys', 'admins', 'sesiones_admin'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end
$$;

-- El rol de sistema saltea RLS, pero igual necesita permisos sobre las tablas.
grant select, insert, update, delete on
  kioscos, usuarios, membresias, dispositivos, pines, invitaciones, sesiones, passkeys,
  admins, sesiones_admin, cajas, auditoria, integraciones, pagos, ventas, eventos_webhook
to mostrador_sistema;

-- ---------------------------------------------------------------------------
-- Funciones de sistema. Todas: security definer, search_path fijo, dueño mostrador_sistema.
-- ---------------------------------------------------------------------------

reset role;
set local role mostrador_sistema;

-- Credenciales para el login con email y contraseña.
create function auth_credenciales(p_email text)
returns table (
  usuario_id uuid,
  password_hash text,
  segundo_factor_activo boolean,
  totp_secreto_cifrado bytea,
  totp_clave_version smallint,
  bloqueado_hasta timestamptz,
  tiene_passkey boolean
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select u.id, u.password_hash, u.segundo_factor_activo, u.totp_secreto_cifrado,
         u.totp_clave_version, u.bloqueado_hasta,
         exists (select 1 from passkeys p where p.usuario_id = u.id)
  from usuarios u
  where u.email is not null and lower(u.email) = lower(p_email)
$$;

-- Registra un intento de login. Después de 5 fallas seguidas, bloquea con espera creciente
-- (1, 2, 4, ... hasta 60 minutos).
create function auth_registrar_intento(p_usuario uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  n smallint;
begin
  if p_ok then
    update usuarios set intentos_fallidos = 0, bloqueado_hasta = null where id = p_usuario;
    return;
  end if;
  update usuarios set intentos_fallidos = intentos_fallidos + 1 where id = p_usuario
    returning intentos_fallidos into n;
  if n >= 5 then
    update usuarios
      set bloqueado_hasta = now() + least(60, power(2, n - 5))::int * interval '1 minute'
      where id = p_usuario;
  end if;
end
$$;

-- Kioscos donde la persona tiene membresía activa (y el kiosco no está dado de baja).
create function auth_membresias(p_usuario uuid)
returns table (kiosco_id uuid, nombre text, rol text, estado_suscripcion text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select k.id, k.nombre, m.rol, k.estado_suscripcion
  from membresias m join kioscos k on k.id = m.kiosco_id
  where m.usuario_id = p_usuario and m.activa and k.estado_suscripcion <> 'baja'
  order by k.nombre
$$;

-- Verifica que (usuario, kiosco, rol) sea válido para una sesión completa.
create function auth_rol_valido(p_usuario uuid, p_kiosco uuid, p_rol text, p_es_soporte boolean)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when p_es_soporte then p_rol = 'soporte' and exists (
      select 1 from kioscos k where k.id = p_kiosco and k.soporte_hasta > now())
    else exists (
      select 1 from membresias m join kioscos k on k.id = m.kiosco_id
      where m.usuario_id = p_usuario and m.kiosco_id = p_kiosco and m.rol = p_rol
        and m.activa and k.estado_suscripcion <> 'baja')
  end
$$;

create function auth_crear_sesion(
  p_id uuid, p_token_hash text, p_usuario uuid, p_kiosco uuid, p_rol text,
  p_dispositivo uuid, p_tipo text, p_vence timestamptz, p_inactividad integer,
  p_es_soporte boolean
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_tipo = 'completa' and not auth_rol_valido(p_usuario, p_kiosco, p_rol, p_es_soporte) then
    raise exception 'sesion_invalida' using errcode = 'P0001';
  end if;
  if p_dispositivo is not null and not exists (
    select 1 from dispositivos d
    where d.id = p_dispositivo and d.kiosco_id = p_kiosco and d.revocado_en is null
  ) then
    raise exception 'sesion_invalida' using errcode = 'P0001';
  end if;
  insert into sesiones (id, token_hash, usuario_id, kiosco_id, rol, dispositivo_id, tipo,
                        vence_en, inactividad_seg, es_soporte)
  values (p_id, p_token_hash, p_usuario, p_kiosco, p_rol, p_dispositivo, p_tipo, p_vence,
          p_inactividad, p_es_soporte);
end
$$;

-- Devuelve la sesión si sigue vigente y renueva la última actividad. Borra las vencidas.
create function auth_leer_sesion(p_token_hash text)
returns table (
  id uuid, usuario_id uuid, kiosco_id uuid, rol text, dispositivo_id uuid, tipo text,
  es_soporte boolean, vence_en timestamptz, nombre text, email text, desafio text
)
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  s sesiones%rowtype;
begin
  select * into s from sesiones where token_hash = p_token_hash;
  if not found then
    return;
  end if;
  if s.vence_en <= now()
     or (s.inactividad_seg is not null
         and s.ultima_actividad + s.inactividad_seg * interval '1 second' <= now())
     or (s.tipo = 'completa' and not auth_rol_valido(s.usuario_id, s.kiosco_id, s.rol, s.es_soporte))
     or (s.dispositivo_id is not null and exists (
           select 1 from dispositivos d where d.id = s.dispositivo_id and d.revocado_en is not null))
  then
    delete from sesiones where sesiones.id = s.id;
    return;
  end if;
  update sesiones set ultima_actividad = now() where sesiones.id = s.id;
  return query
    select s.id, s.usuario_id, s.kiosco_id, s.rol, s.dispositivo_id, s.tipo, s.es_soporte,
           s.vence_en, u.nombre, u.email, s.desafio
    from usuarios u where u.id = s.usuario_id;
end
$$;

-- Completa el segundo factor o cambia de kiosco: nueva sesión con otro token (rotación).
create function auth_completar_sesion(
  p_token_hash_viejo text, p_token_hash_nuevo text, p_kiosco uuid, p_rol text,
  p_vence timestamptz, p_inactividad integer
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  s sesiones%rowtype;
begin
  select * into s from sesiones where token_hash = p_token_hash_viejo for update;
  if not found or s.vence_en <= now() or s.es_soporte then
    raise exception 'sesion_invalida' using errcode = 'P0001';
  end if;
  if not auth_rol_valido(s.usuario_id, p_kiosco, p_rol, false) then
    raise exception 'sesion_invalida' using errcode = 'P0001';
  end if;
  update sesiones
    set token_hash = p_token_hash_nuevo, kiosco_id = p_kiosco, rol = p_rol, tipo = 'completa',
        vence_en = p_vence, inactividad_seg = p_inactividad, ultima_actividad = now(),
        desafio = null
    where sesiones.id = s.id;
end
$$;

create function auth_guardar_desafio(p_token_hash text, p_desafio text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update sesiones set desafio = p_desafio where token_hash = p_token_hash
$$;

create function auth_borrar_sesion(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from sesiones where token_hash = p_token_hash
$$;

-- Cierra todas las sesiones de una persona (por ejemplo, al cambiar la contraseña).
create function auth_borrar_sesiones_usuario(p_usuario uuid, p_salvo_token_hash text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from sesiones where usuario_id = p_usuario and token_hash <> coalesce(p_salvo_token_hash, '')
$$;

create function auth_usar_codigo_recuperacion(p_usuario uuid, p_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update usuarios set codigos_recuperacion = array_remove(codigos_recuperacion, p_hash)
    where id = p_usuario and p_hash = any(codigos_recuperacion);
  return found;
end
$$;

-- Segundo factor: se configura con la sesión pendiente (todavía sin kiosco).
create function auth_guardar_totp(p_usuario uuid, p_secreto bytea, p_version smallint) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update usuarios set totp_secreto_cifrado = p_secreto, totp_clave_version = p_version, updated_at = now()
  where id = p_usuario
$$;

create function auth_leer_totp(p_usuario uuid)
returns table (totp_secreto_cifrado bytea, totp_clave_version smallint, segundo_factor_activo boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select totp_secreto_cifrado, totp_clave_version, segundo_factor_activo from usuarios where id = p_usuario
$$;

create function auth_activar_segundo_factor(p_usuario uuid, p_codigos text[]) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update usuarios set segundo_factor_activo = true, codigos_recuperacion = p_codigos, updated_at = now()
  where id = p_usuario
$$;

-- Invitaciones
create function auth_buscar_invitacion(p_token_hash text)
returns table (kiosco_id uuid, kiosco_nombre text, email text, rol text, usuario_existe boolean)
language sql stable security definer set search_path = public, pg_temp
as $$
  select i.kiosco_id, k.nombre, i.email, i.rol,
         exists (select 1 from usuarios u where u.email is not null and lower(u.email) = lower(i.email))
  from invitaciones i join kioscos k on k.id = i.kiosco_id
  where i.token_hash = p_token_hash and i.usada_en is null and i.vence_en > now()
    and k.estado_suscripcion <> 'baja'
$$;

-- Acepta la invitación: crea la persona (si no existe) y su membresía. Si la persona ya existe,
-- la API tiene que haber verificado su contraseña antes; acá se pasa p_password_hash = null.
create function auth_aceptar_invitacion(
  p_token_hash text, p_usuario_nuevo uuid, p_membresia uuid, p_nombre text, p_password_hash text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  i invitaciones%rowtype;
  v_usuario uuid;
begin
  select * into i from invitaciones
    where token_hash = p_token_hash and usada_en is null and vence_en > now()
    for update;
  if not found then
    raise exception 'invitacion_invalida' using errcode = 'P0001';
  end if;

  select u.id into v_usuario from usuarios u
    where u.email is not null and lower(u.email) = lower(i.email);
  if v_usuario is null then
    if p_password_hash is null then
      raise exception 'invitacion_invalida' using errcode = 'P0001';
    end if;
    insert into usuarios (id, email, nombre, password_hash)
      values (p_usuario_nuevo, lower(i.email), p_nombre, p_password_hash);
    v_usuario := p_usuario_nuevo;
  end if;

  insert into membresias (id, kiosco_id, usuario_id, rol)
    values (p_membresia, i.kiosco_id, v_usuario, i.rol)
    on conflict (kiosco_id, usuario_id) do update set rol = excluded.rol, activa = true, updated_at = now();
  update invitaciones set usada_en = now() where id = i.id;
  insert into auditoria (id, kiosco_id, usuario_id, accion, detalle)
    values (gen_random_uuid(), i.kiosco_id, v_usuario, 'invitacion.aceptada',
            jsonb_build_object('rol', i.rol));
  return v_usuario;
end
$$;

-- Personas del kiosco de la sesión (usa app.kiosco_id: se llama dentro de withKiosco).
-- Valida el límite de usuarios del plan en el servidor.
create function kiosco_verificar_limite_usuarios() returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan text;
  v_activos int;
  v_pendientes int;
begin
  select plan into v_plan from kioscos where id = app_kiosco_id();
  if v_plan is null then
    raise exception 'sin_kiosco' using errcode = 'P0001';
  end if;
  select count(*) into v_activos from membresias where kiosco_id = app_kiosco_id() and activa;
  select count(*) into v_pendientes from invitaciones
    where kiosco_id = app_kiosco_id() and usada_en is null and vence_en > now();
  if v_activos + v_pendientes >= (case v_plan when 'esencial' then 1 else 3 end) then
    raise exception 'limite_plan' using errcode = 'P0001';
  end if;
end
$$;

create function kiosco_crear_cajero(p_usuario uuid, p_membresia uuid, p_nombre text) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform kiosco_verificar_limite_usuarios();
  insert into usuarios (id, nombre) values (p_usuario, p_nombre);
  insert into membresias (id, kiosco_id, usuario_id, rol)
    values (p_membresia, app_kiosco_id(), p_usuario, 'cajero');
end
$$;

create function kiosco_crear_invitacion(
  p_id uuid, p_email text, p_rol text, p_token_hash text, p_vence timestamptz, p_creada_por uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_rol not in ('encargado') then
    raise exception 'rol_invalido' using errcode = 'P0001';
  end if;
  perform kiosco_verificar_limite_usuarios();
  insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en, creada_por)
    values (p_id, app_kiosco_id(), lower(p_email), p_rol, p_token_hash, p_vence, p_creada_por);
end
$$;

-- Dispositivos registrados
create function auth_dispositivo(p_credencial_hash text)
returns table (dispositivo_id uuid, kiosco_id uuid, nombre text)
language sql security definer set search_path = public, pg_temp
as $$
  update dispositivos set ultimo_uso = now()
  where credencial_hash = p_credencial_hash and revocado_en is null
  returning id, kiosco_id, nombre
$$;

-- Passkeys
create function auth_passkeys(p_usuario uuid)
returns table (credential_id text, clave_publica bytea, contador bigint, transportes text[])
language sql stable security definer set search_path = public, pg_temp
as $$
  select credential_id, clave_publica, contador, transportes from passkeys where usuario_id = p_usuario
$$;

create function auth_guardar_passkey(
  p_id uuid, p_usuario uuid, p_credential_id text, p_clave bytea, p_contador bigint,
  p_transportes text[], p_nombre text
) returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into passkeys (id, usuario_id, credential_id, clave_publica, contador, transportes, nombre)
  values (p_id, p_usuario, p_credential_id, p_clave, p_contador, p_transportes, p_nombre)
$$;

create function auth_contador_passkey(p_usuario uuid, p_credential_id text, p_contador bigint) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update passkeys set contador = p_contador where usuario_id = p_usuario and credential_id = p_credential_id
$$;

create function auth_listar_passkeys(p_usuario uuid)
returns table (id uuid, nombre text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select id, nombre, created_at from passkeys where usuario_id = p_usuario order by created_at
$$;

create function auth_borrar_passkey(p_usuario uuid, p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from passkeys where usuario_id = p_usuario and id = p_id;
  return found;
end
$$;

-- ---------------------------------------------------------------------------
-- Panel de administración (rol mostrador_panel, solo por Tailscale)
-- ---------------------------------------------------------------------------

create function panel_credenciales(p_email text)
returns table (admin_id uuid, password_hash text, totp_secreto_cifrado bytea, totp_clave_version smallint, bloqueado_hasta timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select id, password_hash, totp_secreto_cifrado, totp_clave_version, bloqueado_hasta
  from admins where lower(email) = lower(p_email)
$$;

create function panel_registrar_intento(p_admin uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  n smallint;
begin
  if p_ok then
    update admins set intentos_fallidos = 0, bloqueado_hasta = null where id = p_admin;
    return;
  end if;
  update admins set intentos_fallidos = intentos_fallidos + 1 where id = p_admin
    returning intentos_fallidos into n;
  if n >= 5 then
    update admins set bloqueado_hasta = now() + least(60, power(2, n - 5))::int * interval '1 minute'
      where id = p_admin;
  end if;
end
$$;

create function panel_crear_sesion(p_id uuid, p_token_hash text, p_admin uuid, p_tipo text, p_vence timestamptz)
returns void
language sql security definer set search_path = public, pg_temp
as $$
  insert into sesiones_admin (id, token_hash, admin_id, tipo, vence_en)
  values (p_id, p_token_hash, p_admin, p_tipo, p_vence)
$$;

create function panel_leer_sesion(p_token_hash text)
returns table (id uuid, admin_id uuid, tipo text, email text)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  delete from sesiones_admin
    where vence_en <= now() or ultima_actividad + interval '30 minutes' <= now();
  update sesiones_admin set ultima_actividad = now() where token_hash = p_token_hash;
  return query
    select s.id, s.admin_id, s.tipo, a.email
    from sesiones_admin s join admins a on a.id = s.admin_id
    where s.token_hash = p_token_hash;
end
$$;

create function panel_completar_sesion(p_viejo text, p_nuevo text, p_vence timestamptz) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update sesiones_admin set token_hash = p_nuevo, tipo = 'completa', vence_en = p_vence
    where token_hash = p_viejo and vence_en > now();
  return found;
end
$$;

create function panel_borrar_sesion(p_token_hash text) returns void
language sql security definer set search_path = public, pg_temp
as $$
  delete from sesiones_admin where token_hash = p_token_hash
$$;

create function panel_listar_kioscos()
returns table (
  id uuid, nombre text, cuit text, plan text, estado_suscripcion text, soporte_hasta timestamptz,
  created_at timestamptz, usuarios bigint, dueno_email text, ultima_venta timestamptz
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select k.id, k.nombre, k.cuit, k.plan, k.estado_suscripcion, k.soporte_hasta, k.created_at,
         (select count(*) from membresias m where m.kiosco_id = k.id and m.activa),
         (select u.email from membresias m join usuarios u on u.id = m.usuario_id
            where m.kiosco_id = k.id and m.rol = 'dueno' and m.activa order by m.created_at limit 1),
         (select max(v.recibida_en) from ventas v where v.kiosco_id = k.id)
  from kioscos k
  order by k.created_at desc
$$;

-- Alta de kiosco con su caja y la invitación del dueño.
create function panel_crear_kiosco(
  p_kiosco uuid, p_nombre text, p_cuit text, p_plan text, p_caja uuid,
  p_invitacion uuid, p_email text, p_token_hash text, p_vence timestamptz, p_admin uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into kioscos (id, nombre, cuit, plan) values (p_kiosco, p_nombre, nullif(p_cuit, ''), p_plan);
  insert into cajas (id, kiosco_id) values (p_caja, p_kiosco);
  insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en)
    values (p_invitacion, p_kiosco, lower(p_email), 'dueno', p_token_hash, p_vence);
  insert into auditoria (id, kiosco_id, accion, es_soporte, detalle)
    values (gen_random_uuid(), p_kiosco, 'kiosco.alta', true, jsonb_build_object('admin', p_admin));
end
$$;

create function panel_nueva_invitacion_dueno(
  p_kiosco uuid, p_invitacion uuid, p_email text, p_token_hash text, p_vence timestamptz
) returns void
language sql security definer set search_path = public, pg_temp
as $$
  update invitaciones set vence_en = now() where kiosco_id = p_kiosco and rol = 'dueno' and usada_en is null;
  insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en)
    values (p_invitacion, p_kiosco, lower(p_email), 'dueno', p_token_hash, p_vence);
$$;

create function panel_actualizar_kiosco(p_kiosco uuid, p_plan text, p_estado text, p_admin uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update kioscos set plan = p_plan, estado_suscripcion = p_estado, updated_at = now() where id = p_kiosco;
  if not found then
    return false;
  end if;
  insert into auditoria (id, kiosco_id, accion, es_soporte, detalle)
    values (gen_random_uuid(), p_kiosco, 'kiosco.plan', true,
            jsonb_build_object('plan', p_plan, 'estado', p_estado, 'admin', p_admin));
  return true;
end
$$;

-- Soporte: solo si el dueño activó el acceso (kioscos.soporte_hasta en el futuro).
-- El soporte entra con una persona propia (una por admin) que no tiene membresía.
create function panel_crear_sesion_soporte(
  p_admin uuid, p_kiosco uuid, p_usuario_soporte uuid, p_sesion uuid, p_token_hash text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_hasta timestamptz;
  v_email text;
begin
  select soporte_hasta into v_hasta from kioscos where id = p_kiosco;
  if v_hasta is null or v_hasta <= now() then
    return false;
  end if;
  select email into v_email from admins where id = p_admin;
  insert into usuarios (id, nombre) values (p_usuario_soporte, 'Soporte Mostrador')
    on conflict (id) do nothing;
  insert into sesiones (id, token_hash, usuario_id, kiosco_id, rol, tipo, vence_en, es_soporte)
    values (p_sesion, p_token_hash, p_usuario_soporte, p_kiosco, 'soporte', 'completa',
            least(v_hasta, now() + interval '2 hours'), true);
  insert into auditoria (id, kiosco_id, usuario_id, accion, es_soporte, detalle)
    values (gen_random_uuid(), p_kiosco, p_usuario_soporte, 'soporte.entrada', true,
            jsonb_build_object('admin', v_email));
  return true;
end
$$;

reset role;

-- Nadie ejecuta las funciones salvo el rol que corresponde.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname as nombre
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'auth\_%' or p.proname like 'kiosco\_%' or p.proname like 'panel\_%')
  loop
    execute format('revoke all on function %s from public', f.firma);
    if f.nombre like 'panel\_%' then
      execute format('grant execute on function %s to mostrador_panel', f.firma);
    else
      execute format('grant execute on function %s to mostrador_app', f.firma);
    end if;
  end loop;
end
$$;
