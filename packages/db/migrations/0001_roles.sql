-- Roles de base de datos (sección 8 de docs/SPEC.md).
-- Corre como el usuario administrador (superusuario en desarrollo y CI).
-- Los roles son de todo el cluster: se crean solo si no existen.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'mostrador_owner') then
    create role mostrador_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mostrador_app') then
    create role mostrador_app login;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'mostrador_reportes') then
    create role mostrador_reportes login;
  end if;
end
$$;

-- Ninguno de los roles de la app puede saltear RLS ni crear objetos.
alter role mostrador_owner nosuperuser nocreatedb nocreaterole nobypassrls;
alter role mostrador_app nosuperuser nocreatedb nocreaterole nobypassrls noinherit;
alter role mostrador_reportes nosuperuser nocreatedb nocreaterole nobypassrls noinherit;

-- El administrador tiene que poder actuar como dueño para que los objetos queden a su nombre.
grant mostrador_owner to current_user;

-- Esquema public: nadie crea objetos salvo el dueño.
revoke all on schema public from public;
grant usage, create on schema public to mostrador_owner;
grant usage on schema public to mostrador_app;

-- Esquema de reportes (fase 2): vistas de solo lectura, también sujetas a RLS.
create schema if not exists reportes authorization mostrador_owner;
revoke all on schema reportes from public;
grant usage on schema reportes to mostrador_reportes;

-- Conexión a la base solo para los roles con login de la app.
do $$
begin
  execute format('revoke all on database %I from public', current_database());
  execute format('grant connect on database %I to mostrador_app', current_database());
  execute format('grant connect on database %I to mostrador_reportes', current_database());
end
$$;
