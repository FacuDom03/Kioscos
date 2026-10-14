-- Etapa F: Mercado Pago (sección 13 de docs/SPEC.md). Ver docs/decisiones/007.

set local role mostrador_owner;

-- Estado de OAuth: aleatorio, de un solo uso, ligado al kiosco y a la persona, vence en 10 minutos.
create table oauth_estados (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  usuario_id uuid not null,
  state_hash text not null unique,
  -- code_verifier de PKCE, cifrado con la clave maestra.
  verificador_cifrado bytea not null,
  clave_version smallint not null,
  vence_en timestamptz not null,
  usado_en timestamptz,
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id)
);
alter table oauth_estados enable row level security;
alter table oauth_estados force row level security;
create policy aislamiento_kiosco on oauth_estados
  using (kiosco_id = app_kiosco_id())
  with check (kiosco_id = app_kiosco_id());
grant select, insert on oauth_estados to mostrador_app;
grant update (usado_en) on oauth_estados to mostrador_app;

-- Cobros QR: cuándo vence la orden y cuándo se consultó por última vez a Mercado Pago.
alter table pagos add column vence_en timestamptz;
alter table pagos add column ultima_consulta timestamptz;
grant update (ultima_consulta, vence_en) on pagos to mostrador_app;

-- Al resolver una venta pendiente de cobro (QR que no se confirmó) se puede agregar otro pago.
grant update (estado) on ventas to mostrador_app;

reset role;
set local role mostrador_sistema;

-- El webhook llega sin kiosco: se busca el pago por la orden de Mercado Pago.
create function mp_pago_por_orden(p_orden text)
returns table (kiosco_id uuid, pago_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select kiosco_id, id from pagos where mp_order_id = p_orden and medio = 'qr_mp'
$$;

-- Para el worker: pagos QR sin confirmar de las últimas 24 horas, de todos los kioscos.
create function mp_pagos_pendientes()
returns table (kiosco_id uuid, pago_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select kiosco_id, id from pagos
  where medio = 'qr_mp' and estado = 'pendiente' and mp_order_id is not null
    and created_at > now() - interval '24 hours'
    and (ultima_consulta is null or ultima_consulta < now() - interval '1 minute')
  order by created_at
  limit 500
$$;

-- Para el worker: integraciones conectadas cuyo token vence en menos de 30 días.
create function mp_integraciones_a_renovar()
returns table (kiosco_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select kiosco_id from integraciones
  where proveedor = 'mercadopago' and estado = 'conectado' and vence_en < now() + interval '30 days'
$$;

reset role;
revoke all on function mp_pago_por_orden(text) from public;
revoke all on function mp_pagos_pendientes() from public;
revoke all on function mp_integraciones_a_renovar() from public;
grant execute on function mp_pago_por_orden(text) to mostrador_app;
grant execute on function mp_pagos_pendientes() to mostrador_app;
grant execute on function mp_integraciones_a_renovar() to mostrador_app;
