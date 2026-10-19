-- Facturación electrónica con ARCA, por medio de Afip SDK (docs/FACTURACION.md y decisión 010).
-- OK del dueño del proyecto (octubre de 2026): tablas de facturación y, solo cuando haga falta,
-- el documento del comprador. Es una función que el comercio activa ("facturacion" en módulos).

set local role mostrador_owner;

-- Mantener en sincronía con MODULOS de packages/shared/src/rubros.ts.
alter table kioscos drop constraint kioscos_modulos_check;
alter table kioscos add constraint kioscos_modulos_check
  check (modulos <@ array[
    'venta_fraccionada', 'presupuestos', 'listas_precios', 'ubicaciones', 'precios_proveedor',
    'cuenta_corriente', 'variantes', 'promos', 'regalo', 'vencimientos', 'facturacion'
  ]::text[]);

-- Los datos fiscales del comercio: con qué CUIT y punto de venta factura. Una por comercio.
create table config_fiscal (
  id uuid primary key,
  kiosco_id uuid not null unique references kioscos (id),
  cuit text not null check (cuit ~ '^[0-9]{11}$'),
  razon_social text not null check (length(razon_social) between 1 and 120),
  condicion text not null check (condicion in ('monotributo', 'exento', 'responsable_inscripto')),
  punto_venta integer not null check (punto_venta between 1 and 99998),
  domicilio text not null check (length(domicilio) between 1 and 200),
  iibb text check (length(iibb) between 1 and 30),
  inicio_actividades date,
  -- pendiente: esperando que ARCA confirme la autorización a Mostrador. activa: factura.
  -- pausada: la pausó el dueño. desconectada: ARCA rechaza la autorización. suspendida: la
  -- suspendió Mostrador (abuso). baja: el comercio dejó de facturar.
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'activa', 'pausada', 'desconectada', 'suspendida', 'baja')),
  ultimo_error text check (length(ultimo_error) <= 300),
  verificada_en timestamptz,
  activada_en timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kiosco_id, id)
);

-- Cada factura o nota de crédito. Se crea pendiente junto con la venta (o la anulación) y la
-- cola de facturas le pide el CAE a ARCA.
create table comprobantes (
  id uuid primary key,
  kiosco_id uuid not null,
  venta_id uuid not null,
  tipo text not null check (tipo in (
    'factura_a', 'factura_b', 'factura_c', 'nota_credito_a', 'nota_credito_b', 'nota_credito_c'
  )),
  punto_venta integer not null check (punto_venta between 1 and 99998),
  -- Se fija justo antes de pedir el CAE: si se corta la respuesta, se consulta ese número.
  numero integer check (numero >= 1),
  fecha date,
  total bigint not null check (total > 0),
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'autorizado', 'rechazado', 'cancelado')),
  cae text check (cae ~ '^[0-9]{14}$'),
  cae_vence date,
  intentos integer not null default 0,
  ultimo_error text check (length(ultimo_error) <= 300),
  -- La factura que anula una nota de crédito.
  anula_id uuid,
  -- Comprador: consumidor final sin identificar, salvo que pida factura a su nombre o la venta
  -- llegue al tope de identificación (dato personal: entra en la exportación y en el borrado).
  receptor_condicion text not null default 'consumidor_final'
    check (receptor_condicion in ('consumidor_final', 'monotributo', 'responsable_inscripto', 'exento')),
  receptor_doc_tipo text check (receptor_doc_tipo in ('cuit', 'cuil', 'dni')),
  receptor_doc_nro text check (receptor_doc_nro ~ '^[0-9]{7,11}$'),
  -- Emitido en modo de prueba (CUIT de pruebas de ARCA): no vale como factura.
  prueba boolean not null default false,
  created_at timestamptz not null default now(),
  autorizado_en timestamptz,
  unique (kiosco_id, id),
  unique (kiosco_id, venta_id, tipo),
  foreign key (kiosco_id, venta_id) references ventas (kiosco_id, id),
  foreign key (kiosco_id, anula_id) references comprobantes (kiosco_id, id),
  check ((estado = 'autorizado') = (cae is not null)),
  check ((tipo like 'nota_credito%') = (anula_id is not null)),
  check ((receptor_doc_tipo is null) = (receptor_doc_nro is null))
);
create unique index comprobantes_numero_uq on comprobantes (kiosco_id, punto_venta, tipo, numero)
  where estado = 'autorizado' and not prueba;
create index comprobantes_pendientes_idx on comprobantes (kiosco_id, created_at)
  where estado = 'pendiente';

do $$
declare
  t text;
begin
  foreach t in array array['config_fiscal', 'comprobantes']
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

grant select, insert on config_fiscal, comprobantes to mostrador_app;
grant update (
  cuit, razon_social, condicion, punto_venta, domicilio, iibb, inicio_actividades, estado,
  ultimo_error, verificada_en, activada_en, updated_at
) on config_fiscal to mostrador_app;
grant update (numero, fecha, estado, cae, cae_vence, intentos, ultimo_error, autorizado_en)
  on comprobantes to mostrador_app;

reset role;

grant select, delete on config_fiscal, comprobantes to mostrador_sistema;

set local role mostrador_sistema;

-- Para el worker: comercios con la facturación activa o esperando que ARCA la confirme.
create function fact_kioscos_a_revisar()
returns table (kiosco_id uuid, estado text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.kiosco_id, c.estado from config_fiscal c join kioscos k on k.id = c.kiosco_id
  where c.estado in ('activa', 'pendiente') and k.estado_suscripcion <> 'baja'
    and 'facturacion' = any (k.modulos)
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

revoke all on function fact_kioscos_a_revisar() from public;
grant execute on function fact_kioscos_a_revisar() to mostrador_app;
