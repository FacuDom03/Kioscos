-- Factura a nombre de quien compra (docs/FACTURACION.md), como en Odoo: el cliente se guarda con
-- sus datos fiscales y se elige al cobrar. OK del dueño del proyecto (octubre de 2026): datos
-- del comprador para facturar.

set local role mostrador_owner;

alter table clientes
  add column doc_tipo text check (doc_tipo in ('cuit', 'cuil', 'dni')),
  add column doc_nro text check (doc_nro ~ '^[0-9]{7,11}$'),
  add column condicion_iva text
    check (condicion_iva in ('consumidor_final', 'monotributo', 'responsable_inscripto', 'exento')),
  -- Domicilio fiscal (sale en la factura en hoja).
  add column domicilio text check (length(domicilio) between 1 and 200),
  add constraint clientes_documento_check check ((doc_tipo is null) = (doc_nro is null));
-- Un mismo CUIT o DNI no se carga dos veces en el comercio.
create unique index clientes_documento_idx on clientes (kiosco_id, doc_tipo, doc_nro)
  where doc_nro is not null and activo;

-- A nombre de quién sale la factura de la venta (sin esto, a consumidor final).
alter table ventas
  add column comprador_id uuid,
  add constraint ventas_comprador_fk
    foreign key (kiosco_id, comprador_id) references clientes (kiosco_id, id);

-- Copia de los datos del comprador al facturar: si después se edita el cliente, la factura no
-- cambia.
alter table comprobantes
  add column receptor_nombre text check (length(receptor_nombre) between 1 and 80),
  add column receptor_domicilio text check (length(receptor_domicilio) between 1 and 200);

reset role;

grant update (doc_tipo, doc_nro, condicion_iva, domicilio) on clientes to mostrador_app;
