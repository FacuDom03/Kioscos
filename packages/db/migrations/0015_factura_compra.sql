-- Compras como factura de compra (pedido del dueño del proyecto, estilo Odoo): proveedor, tipo y
-- número de comprobante, fecha de la factura, renglones sin producto (flete, bolsas, servicios)
-- y, por renglón, si suma stock o no (por ejemplo, si la mercadería ya entró con el remito).
-- Todo es compatible: columnas nuevas opcionales; las compras anteriores quedan igual.

set local role mostrador_owner;

alter table compras
  add column proveedor_id uuid,
  add column comprobante text
    check (comprobante in ('factura_a', 'factura_b', 'factura_c', 'remito', 'ticket', 'otro')),
  add column numero text check (length(numero) between 1 and 30),
  add column fecha date,
  add constraint compras_proveedor_fk
    foreign key (kiosco_id, proveedor_id) references proveedores (kiosco_id, id),
  add constraint compras_numero_con_comprobante check (numero is null or comprobante is not null);

-- La misma factura del mismo proveedor no se carga dos veces.
create unique index compras_comprobante_uq on compras (kiosco_id, proveedor_id, comprobante, numero)
  where proveedor_id is not null and numero is not null;
create index compras_proveedor_idx on compras (kiosco_id, proveedor_id, created_at);

alter table compra_items
  alter column producto_id drop not null,
  add column descripcion text check (length(descripcion) between 1 and 120),
  add column suma_stock boolean not null default true,
  add constraint compra_items_que_es check (producto_id is not null or descripcion is not null),
  -- Un renglón sin producto (un flete) no mueve stock.
  add constraint compra_items_stock_de_producto check (producto_id is not null or not suma_stock);

reset role;
