-- Aislamiento entre kioscos con RLS y permisos mínimos del rol de la API
-- (secciones 8 y 18 de docs/SPEC.md).
--
-- La API fija el kiosco por transacción:
--   select set_config('app.kiosco_id', $1, true)
-- Si no está fijado, las políticas no dejan ver ni escribir nada (falla cerrada).

set local role mostrador_owner;

create function app_kiosco_id() returns uuid
  language sql
  stable
  parallel safe
as $$
  select nullif(current_setting('app.kiosco_id', true), '')::uuid
$$;

revoke all on function app_kiosco_id() from public;
grant execute on function app_kiosco_id() to mostrador_app, mostrador_reportes;

-- ---------------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------------

-- Tablas de negocio con kiosco_id: misma política en todas.
do $$
declare
  t text;
begin
  foreach t in array array[
    'membresias', 'dispositivos', 'pines', 'categorias', 'productos', 'codigos_barra',
    'compras', 'compra_items', 'cambios_precio', 'cajas', 'turnos_caja', 'gastos', 'ventas',
    'venta_items', 'pagos', 'movimientos_stock', 'integraciones', 'auditoria'
  ]
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

-- El kiosco solo se ve a sí mismo.
alter table kioscos enable row level security;
alter table kioscos force row level security;
create policy aislamiento_kiosco on kioscos
  using (id = app_kiosco_id())
  with check (id = app_kiosco_id());

-- Las personas no son de un kiosco: se ven solo si tienen membresía en el kiosco de la sesión.
-- (La subconsulta sobre membresias también pasa por RLS.)
alter table usuarios enable row level security;
alter table usuarios force row level security;
create policy miembros_del_kiosco on usuarios
  using (exists (select 1 from membresias m where m.usuario_id = usuarios.id))
  with check (exists (select 1 from membresias m where m.usuario_id = usuarios.id));

-- ---------------------------------------------------------------------------
-- Permisos del rol de la API (mostrador_app)
-- Lo que no está acá, no se puede. Las tablas de solo agregar filas no tienen UPDATE ni DELETE.
-- ---------------------------------------------------------------------------

grant select on kioscos to mostrador_app;
grant update (nombre, cuit, soporte_hasta, updated_at) on kioscos to mostrador_app;

grant select on usuarios to mostrador_app;
grant update (password_hash, totp_secreto_cifrado, totp_clave_version, segundo_factor_activo, updated_at)
  on usuarios to mostrador_app;

grant select, insert on membresias to mostrador_app;
grant update (rol, activa, updated_at) on membresias to mostrador_app;

grant select, insert on dispositivos to mostrador_app;
grant update (nombre, ultimo_uso, revocado_en, updated_at) on dispositivos to mostrador_app;

grant select, insert, delete on pines to mostrador_app;
grant update (pin_hash, intentos_fallidos, bloqueado_hasta, updated_at) on pines to mostrador_app;

grant select, insert, delete on categorias to mostrador_app;
grant update (nombre, orden, updated_at) on categorias to mostrador_app;

grant select, insert on productos to mostrador_app;
grant update (categoria_id, nombre, precio, costo, stock_actual, stock_minimo, activo, updated_at)
  on productos to mostrador_app;

grant select, insert, delete on codigos_barra to mostrador_app;

grant select, insert on compras, compra_items to mostrador_app;

grant select, insert on cambios_precio to mostrador_app;
grant update (deshecho_en, deshecho_por) on cambios_precio to mostrador_app;

grant select, insert on cajas to mostrador_app;
grant update (nombre, updated_at) on cajas to mostrador_app;

grant select, insert on turnos_caja to mostrador_app;
grant update (cerrado_por, cerrado_en, esperado, contado, diferencia, nota) on turnos_caja to mostrador_app;

grant select, insert on gastos to mostrador_app;

grant select, insert on ventas to mostrador_app;
grant update (estado, devolucion_pendiente, anulada_por, anulada_en, motivo_anulacion)
  on ventas to mostrador_app;

grant select, insert on venta_items to mostrador_app;

grant select, insert on pagos to mostrador_app;
grant update (estado, recibido, vuelto, mp_order_id, mp_payment_id, confirmado_en, updated_at)
  on pagos to mostrador_app;

grant select, insert on movimientos_stock to mostrador_app;

grant select, insert on integraciones to mostrador_app;
grant update (
  estado, mp_user_id, access_token_cifrado, refresh_token_cifrado, clave_version, vence_en,
  mp_sucursal_id, mp_caja_id, mp_external_pos_id, updated_at
) on integraciones to mostrador_app;

grant select, insert on auditoria to mostrador_app;

-- Tabla global (sin kiosco): solo IDs de eventos para no procesar dos veces.
grant select, insert on eventos_webhook to mostrador_app;
grant update (procesado_en, resultado) on eventos_webhook to mostrador_app;
