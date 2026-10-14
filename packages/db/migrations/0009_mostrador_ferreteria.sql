-- Etapa I2: mostrador de ferretería. Ver docs/decisiones/009-rubros.md.
-- Cambio compatible: columnas nuevas con valores por defecto.

set local role mostrador_owner;

-- Unidad de venta. Con metro, kilo o litro se vende con decimales (la cantidad ya admite 3).
-- Mantener en sincronía con UNIDADES de packages/shared/src/unidades.ts.
alter table productos add column unidad text not null default 'unidad'
  check (unidad in ('unidad', 'metro', 'kilo', 'litro', 'caja'));

-- Dónde está en el local ("Pasillo 3 · B").
alter table productos add column ubicacion text check (length(ubicacion) between 1 and 40);

-- Precio de la lista de gremio. Si no tiene, se usa el de mostrador.
alter table productos add column precio_gremio bigint check (precio_gremio >= 0);

grant update (unidad, ubicacion, precio_gremio) on productos to mostrador_app;

-- Con qué lista se vendió (para el tablero y para revisar precios).
alter table ventas add column lista text not null default 'mostrador'
  check (lista in ('mostrador', 'gremio'));
