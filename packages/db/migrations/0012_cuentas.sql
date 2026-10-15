-- Etapa I5: clientes y cuenta corriente (fiado). Ver docs/decisiones/009-rubros.md.
--
-- Datos personales nuevos (OK del dueño del proyecto): nombre del cliente y, opcional, su
-- teléfono y una nota. Lo mínimo para fiar. Entran en la exportación y se borran con la cuenta;
-- el teléfono se redacta en los logs.

set local role mostrador_owner;

create table clientes (
  id uuid primary key,
  kiosco_id uuid not null references kioscos (id),
  nombre text not null check (length(nombre) between 1 and 80),
  telefono text check (telefono ~ '^[0-9 +()-]{6,30}$'),
  nota text check (length(nota) between 1 and 200),
  -- Hasta cuánto se le fía. Sin límite: null.
  limite bigint check (limite >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);
create index clientes_nombre_idx on clientes (kiosco_id, lower(nombre));

-- Lo que el cliente debe es la suma de sus movimientos: positivo suma deuda, negativo la baja.
create table movimientos_cuenta (
  -- En los pagos, el ID lo genera el equipo: registrar dos veces el mismo pago no lo duplica.
  id uuid primary key,
  kiosco_id uuid not null,
  cliente_id uuid not null,
  tipo text not null check (tipo in ('venta', 'pago', 'anulacion', 'ajuste')),
  monto bigint not null check (monto <> 0),
  medio text check (medio in ('efectivo', 'transferencia')),
  venta_id uuid,
  -- Los pagos en efectivo entran en la caja del turno.
  turno_id uuid,
  usuario_id uuid not null,
  nota text check (length(nota) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (kiosco_id, id),
  check ((tipo = 'pago') = (medio is not null)),
  foreign key (kiosco_id, cliente_id) references clientes (kiosco_id, id),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id),
  foreign key (kiosco_id, turno_id) references turnos_caja (kiosco_id, id),
  foreign key (kiosco_id, usuario_id) references membresias (kiosco_id, usuario_id)
);
create index movimientos_cuenta_cliente_idx on movimientos_cuenta (kiosco_id, cliente_id, created_at);
create index movimientos_cuenta_turno_idx on movimientos_cuenta (kiosco_id, turno_id);

do $$
declare
  t text;
begin
  foreach t in array array['clientes', 'movimientos_cuenta']
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

grant select, insert on clientes to mostrador_app;
grant update (nombre, telefono, nota, limite, activo, updated_at) on clientes to mostrador_app;
grant select, insert on movimientos_cuenta to mostrador_app;

-- Un medio de pago más: a cuenta. No entra en la caja (no es plata que se recibió).
alter table pagos drop constraint pagos_medio_check;
alter table pagos add constraint pagos_medio_check
  check (medio in ('efectivo', 'qr_mp', 'transferencia', 'cuenta_corriente'));

-- A quién se le fió la venta.
alter table ventas add column cliente_id uuid;
alter table ventas add constraint ventas_cliente_fk
  foreign key (kiosco_id, cliente_id) references clientes (kiosco_id, id);

reset role;

grant select, delete on clientes, movimientos_cuenta to mostrador_sistema;

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
  delete from movimientos_cuenta where kiosco_id = k;
  delete from presupuesto_items where kiosco_id = k;
  delete from presupuestos where kiosco_id = k;
  delete from listas_proveedor where kiosco_id = k;
  delete from producto_proveedor where kiosco_id = k;
  delete from proveedores where kiosco_id = k;
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
