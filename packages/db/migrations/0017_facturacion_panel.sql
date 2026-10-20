-- Facturación: términos aceptados y protecciones del panel (decisión 010). Pedido del dueño del
-- proyecto (octubre de 2026): términos y condiciones, y el panel para aceptar autorizaciones,
-- suspender un comercio y fijarle un tope diario.

set local role mostrador_owner;

alter table config_fiscal
  -- Qué versión de los términos aceptó el comercio, cuándo y quién (packages/shared/src/terminos.ts).
  add column terminos_version text check (length(terminos_version) between 1 and 20),
  add column terminos_aceptados_en timestamptz,
  add column terminos_aceptados_por uuid references usuarios (id),
  -- Tope de lo facturado por día, en centavos ($ 5.000.000 de entrada). Lo cambia el panel.
  add column tope_diario bigint not null default 500000000 check (tope_diario > 0);

reset role;

grant update (terminos_version, terminos_aceptados_en, terminos_aceptados_por)
  on config_fiscal to mostrador_app;
grant update (estado, ultimo_error, verificada_en, tope_diario, updated_at)
  on config_fiscal to mostrador_sistema;

set local role mostrador_sistema;

-- Los comercios con facturación, con lo facturado hoy y lo que sirve para las alertas.
-- Primero los que esperan que Mostrador acepte la autorización en ARCA.
create function panel_listar_facturacion()
returns table (
  kiosco_id uuid, comercio text, cuit text, razon_social text, condicion text, punto_venta integer,
  estado text, ultimo_error text, verificada_en timestamptz, activada_en timestamptz,
  terminos_version text, terminos_aceptados_en timestamptz, tope_diario bigint,
  facturado_hoy bigint, facturas_hoy bigint, notas_hoy bigint, pendientes bigint,
  rechazados bigint, mayor_repeticion_hoy bigint, created_at timestamptz
)
language sql stable security definer set search_path = public, pg_temp
as $$
  with hoy as (select (now() at time zone 'America/Argentina/Buenos_Aires')::date as d),
  emitidos as (
    select x.kiosco_id, x.total, x.anula_id
    from comprobantes x, hoy
    where x.estado = 'autorizado' and x.fecha = hoy.d
  )
  select c.kiosco_id, k.nombre, c.cuit, c.razon_social, c.condicion, c.punto_venta, c.estado,
         c.ultimo_error, c.verificada_en, c.activada_en, c.terminos_version,
         c.terminos_aceptados_en, c.tope_diario,
         coalesce((select sum(e.total) from emitidos e
                   where e.kiosco_id = c.kiosco_id and e.anula_id is null), 0)::bigint,
         (select count(*) from emitidos e where e.kiosco_id = c.kiosco_id and e.anula_id is null),
         (select count(*) from emitidos e where e.kiosco_id = c.kiosco_id and e.anula_id is not null),
         (select count(*) from comprobantes x where x.kiosco_id = c.kiosco_id and x.estado = 'pendiente'),
         (select count(*) from comprobantes x where x.kiosco_id = c.kiosco_id and x.estado = 'rechazado'),
         -- El mismo importe alto ($ 100.000 o más) facturado varias veces hoy.
         coalesce((select max(n) from (
           select count(*) as n from emitidos e
           where e.kiosco_id = c.kiosco_id and e.anula_id is null and e.total >= 10000000
           group by e.total) r), 0)::bigint,
         c.created_at
  from config_fiscal c join kioscos k on k.id = c.kiosco_id
  where c.estado <> 'baja'
  order by (c.estado in ('pendiente', 'desconectada')) desc, c.created_at desc
$$;

-- Acciones del panel sobre la facturación de un comercio:
-- - aceptada: ya aceptaste la autorización en ARCA; se prueba en la próxima revisión.
-- - suspender: corta en el momento (el comercio no la puede reanudar).
-- - reactivar: la saca de la suspensión; vuelve a probar con ARCA antes de facturar.
create function panel_facturacion_accion(p_kiosco uuid, p_accion text, p_admin uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if p_accion = 'aceptada' then
    update config_fiscal set estado = 'pendiente', verificada_en = null, updated_at = now()
      where kiosco_id = p_kiosco and estado in ('pendiente', 'desconectada');
  elsif p_accion = 'suspender' then
    update config_fiscal
      set estado = 'suspendida', updated_at = now(),
          ultimo_error = 'Mostrador suspendió la facturación de este comercio. Escribinos para revisarla.'
      where kiosco_id = p_kiosco and estado not in ('suspendida', 'baja');
  elsif p_accion = 'reactivar' then
    update config_fiscal
      set estado = 'pendiente', ultimo_error = null, verificada_en = null, updated_at = now()
      where kiosco_id = p_kiosco and estado = 'suspendida';
  else
    raise exception 'accion_invalida' using errcode = 'P0001';
  end if;
  if not found then
    return false;
  end if;
  insert into auditoria (id, kiosco_id, accion, es_soporte, detalle)
    values (gen_random_uuid(), p_kiosco, 'facturacion.panel.' || p_accion, true,
            jsonb_build_object('admin', p_admin));
  return true;
end
$$;

create function panel_facturacion_tope(p_kiosco uuid, p_tope bigint, p_admin uuid)
returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  update config_fiscal set tope_diario = p_tope, updated_at = now() where kiosco_id = p_kiosco;
  if not found then
    return false;
  end if;
  insert into auditoria (id, kiosco_id, accion, es_soporte, detalle)
    values (gen_random_uuid(), p_kiosco, 'facturacion.panel.tope', true,
            jsonb_build_object('admin', p_admin, 'tope', p_tope));
  return true;
end
$$;

reset role;

revoke all on function panel_listar_facturacion() from public;
revoke all on function panel_facturacion_accion(uuid, text, uuid) from public;
revoke all on function panel_facturacion_tope(uuid, bigint, uuid) from public;
grant execute on function panel_listar_facturacion() to mostrador_panel;
grant execute on function panel_facturacion_accion(uuid, text, uuid) to mostrador_panel;
grant execute on function panel_facturacion_tope(uuid, bigint, uuid) to mostrador_panel;
