-- Datos del QR de la orden (cadena EMVCo, no es un dato sensible) para volver a mostrarlo si la
-- pantalla de cobro se recarga.
set local role mostrador_owner;
alter table pagos add column mp_qr_data text check (length(mp_qr_data) <= 2000);
grant update (mp_qr_data) on pagos to mostrador_app;
