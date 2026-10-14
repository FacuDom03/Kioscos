-- Etapa I1: rubro del comercio y funciones por rubro. Ver docs/decisiones/009-rubros.md.
--
-- Cambio compatible: columnas nuevas con valores por defecto. Los comercios que ya existen
-- quedan como kiosco y ya configurados; los que se dan de alta desde el panel arrancan sin
-- configurar, y el dueño confirma el rubro y elige categorías y funciones al entrar.

set local role mostrador_owner;

alter table kioscos add column rubro text not null default 'kiosco'
  check (rubro in ('kiosco', 'almacen', 'ferreteria', 'perfumeria', 'libreria', 'otro'));

-- Mantener en sincronía con MODULOS de packages/shared/src/rubros.ts.
alter table kioscos add column modulos text[] not null default '{}'
  check (modulos <@ array[
    'venta_fraccionada', 'presupuestos', 'listas_precios', 'ubicaciones', 'precios_proveedor',
    'cuenta_corriente', 'variantes', 'promos', 'regalo', 'vencimientos'
  ]::text[]);

alter table kioscos add column configurado boolean not null default true;

grant update (rubro, modulos, configurado) on kioscos to mostrador_app;

reset role;
set local role mostrador_sistema;

-- El panel elige el rubro al dar de alta (lo confirma el dueño después).
drop function panel_crear_kiosco(uuid, text, text, text, uuid, uuid, text, text, timestamptz, uuid);
create function panel_crear_kiosco(
  p_kiosco uuid, p_nombre text, p_cuit text, p_plan text, p_rubro text, p_caja uuid,
  p_invitacion uuid, p_email text, p_token_hash text, p_vence timestamptz, p_admin uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into kioscos (id, nombre, cuit, plan, rubro, configurado)
    values (p_kiosco, p_nombre, nullif(p_cuit, ''), p_plan, p_rubro, false);
  insert into cajas (id, kiosco_id) values (p_caja, p_kiosco);
  insert into invitaciones (id, kiosco_id, email, rol, token_hash, vence_en)
    values (p_invitacion, p_kiosco, lower(p_email), 'dueno', p_token_hash, p_vence);
  insert into auditoria (id, kiosco_id, accion, es_soporte, detalle)
    values (gen_random_uuid(), p_kiosco, 'kiosco.alta', true,
            jsonb_build_object('admin', p_admin, 'rubro', p_rubro));
end
$$;

drop function panel_listar_kioscos();
create function panel_listar_kioscos()
returns table (
  id uuid, nombre text, cuit text, plan text, rubro text, configurado boolean,
  estado_suscripcion text, soporte_hasta timestamptz, created_at timestamptz, usuarios bigint,
  dueno_email text, ultima_venta timestamptz
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select k.id, k.nombre, k.cuit, k.plan, k.rubro, k.configurado, k.estado_suscripcion,
         k.soporte_hasta, k.created_at,
         (select count(*) from membresias m where m.kiosco_id = k.id and m.activa),
         (select u.email from membresias m join usuarios u on u.id = m.usuario_id
            where m.kiosco_id = k.id and m.rol = 'dueno' and m.activa order by m.created_at limit 1),
         (select max(v.recibida_en) from ventas v where v.kiosco_id = k.id)
  from kioscos k
  order by k.created_at desc
$$;

reset role;

revoke all on function panel_crear_kiosco(uuid, text, text, text, text, uuid, uuid, text, text, timestamptz, uuid) from public;
revoke all on function panel_listar_kioscos() from public;
grant execute on function panel_crear_kiosco(uuid, text, text, text, text, uuid, uuid, text, text, timestamptz, uuid) to mostrador_panel;
grant execute on function panel_listar_kioscos() to mostrador_panel;
