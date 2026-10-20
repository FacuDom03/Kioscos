-- Categoría del monotributo del comercio, para avisar cuando lo facturado se acerca al tope
-- (docs/CONTABILIDAD.md, fase 1). La carga el dueño; si no la carga, no hay aviso de tope.

set local role mostrador_owner;

alter table config_fiscal
  add column categoria_monotributo text check (categoria_monotributo ~ '^[A-K]$');

reset role;

grant update (categoria_monotributo) on config_fiscal to mostrador_app;
