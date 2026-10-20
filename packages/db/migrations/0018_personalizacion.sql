-- Personalización del comercio (pedido del dueño del proyecto, octubre de 2026): logo y texto
-- al pie para los tickets, facturas y presupuestos, y marca de agua en lo que se imprime en hoja.
-- Una fila por comercio. El logo llega achicado desde la app y se guarda como imagen chica.

set local role mostrador_owner;

create table personalizacion (
  id uuid primary key,
  kiosco_id uuid not null unique references kioscos (id),
  -- PNG o JPEG de hasta 150 KB. Nunca SVG (puede llevar código).
  logo bytea check (octet_length(logo) <= 153600),
  logo_tipo text check (logo_tipo in ('image/png', 'image/jpeg')),
  -- Sube con cada logo nuevo: va en la dirección para que el navegador lo guarde sin preguntar.
  logo_version integer not null default 0,
  logo_en_ticket boolean not null default true,
  marca_agua boolean not null default false,
  -- Texto al pie del ticket: "Gracias por tu compra", redes, horarios.
  pie text check (length(pie) between 1 and 200),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id),
  check ((logo is null) = (logo_tipo is null))
);

alter table personalizacion enable row level security;
alter table personalizacion force row level security;
create policy aislamiento_kiosco on personalizacion
  using (kiosco_id = app_kiosco_id())
  with check (kiosco_id = app_kiosco_id());

grant select, insert on personalizacion to mostrador_app;
grant update (logo, logo_tipo, logo_version, logo_en_ticket, marca_agua, pie, updated_at)
  on personalizacion to mostrador_app;

reset role;

grant select, delete on personalizacion to mostrador_sistema;

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
  delete from personalizacion where kiosco_id = k;
  delete from webhooks where kiosco_id = k;
  delete from claves_api where kiosco_id = k;
  -- Las facturas quedan en ARCA ("Mis Comprobantes"); la copia de Mostrador se borra.
  delete from comprobantes where kiosco_id = k and anula_id is not null;
  delete from comprobantes where kiosco_id = k;
  delete from config_fiscal where kiosco_id = k;
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
