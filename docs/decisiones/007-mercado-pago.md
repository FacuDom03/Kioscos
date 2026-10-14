# 007. Mercado Pago: Orders API para QR, OAuth con PKCE y reconsulta como fuente de verdad

**Fecha:** octubre de 2026 · **Etapa:** F

## Documentación consultada (octubre de 2026)

- QR con la API de Orders: `POST /v1/orders` (`type: "qr"`, `config.qr.mode: "dynamic"`,
  `config.qr.external_pos_id`, `external_reference`, `total_amount` como string decimal,
  `expiration_time` ISO 8601, `transactions.payments[].amount`), `GET /v1/orders/{id}`,
  `POST /v1/orders/{id}/cancel`. `X-Idempotency-Key` obligatorio al crear y cancelar. Estados de la
  orden: `created`, `processed`, `canceled`, `refunded`, `expired`. El QR llega en
  `type_response.qr_data` (cadena EMVCo). El tópico de webhook es "Order (Mercado Pago)".
- Sucursales y cajas: `POST /users/{user_id}/stores` (con `external_id`) y `POST /v2/pos`
  (`store_id`, `external_id`, `config.qr.operating_mode: "pdv"`).
- OAuth: `https://auth.mercadopago.com.ar/authorization` con `code_challenge` S256 y `state`;
  `POST /oauth/token` con `grant_type=authorization_code` (+ `code_verifier`) y `refresh_token`.
  El access token dura 180 días.
- Webhooks: `x-signature: ts=…,v1=…`, manifiesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
  (se omite lo que falte), HMAC-SHA256 en hexadecimal con la clave secreta de webhooks.

## Decisión

1. **La fuente de verdad es la reconsulta**, no el webhook. La propia documentación avisa que las
   notificaciones de QR pueden no validarse con la clave secreta. Por eso:
   - el webhook solo se acepta con firma válida y reciente (5 minutos), se registra el evento
     (`eventos_webhook`, sin duplicados) y se encola la reconsulta de esa orden;
   - mientras la pantalla de cobro está abierta, la app pregunta `GET /api/v1/pagos/:id` cada 2 s y
     el servidor reconsulta la orden en Mercado Pago (como mucho cada 3 s por pago);
   - el worker reconsulta cada minuto los cobros QR sin confirmar de las últimas 24 horas.
     Con o sin webhooks, el cobro se confirma.
2. **Verificación antes de aprobar**: la orden tiene que ser la del pago, `external_reference`
   igual al ID de la venta, el mismo monto y la misma cuenta de vendedor (`user_id`) que tiene
   conectada el kiosco. Si algo no coincide, se ignora. Un pago del kiosco A nunca marca una venta
   de B (prueba con dos vendedores).
3. **La venta QR nace "abierta"** con su pago pendiente y sin mover stock. Al aprobarse pasa a
   cobrada y descuenta stock en la misma transacción. Cancelada → anulada. Vencida sin pago →
   "pendiente de cobro", que el dueño o el encargado resuelve en Caja (efectivo, transferencia o
   anular). Si el cliente pagó después de cancelar, queda anulada con devolución pendiente.
4. **Tokens cifrados** con libsodium y la clave maestra versionada fuera de la base. Nunca van al
   cliente ni a los logs. El worker renueva los que vencen en menos de 30 días; si falla (el
   vendedor revocó), la integración pasa a "Requiere atención" y queda en la auditoría.
5. **Worker con BullMQ** (`apps/worker`): la API solo encola. Sin `REDIS_URL` (desarrollo), la API
   reconsulta en el mismo proceso. Los trabajos no llevan datos del kiosco: el worker lo resuelve
   con `mp_pago_por_orden` (función de sistema).
6. **Pruebas sin Mercado Pago real**: un servidor falso (`apps/api/test/mp-falso.ts`) imita OAuth
   con PKCE, sucursales, cajas y órdenes que solo ve el vendedor dueño del token. **Antes de
   conectar un kiosco real** hay que repetir los casos en el entorno de pruebas de Mercado Pago con
   dos cuentas de vendedor (sección 13.5) y confirmar los nombres de campos contra la
   documentación vigente.

## Pendiente

- Devolución por API (`POST /v1/orders/{id}/refund`): fase 2.
- La ubicación de la sucursal se crea genérica (Buenos Aires); el dueño la corrige en Mercado Pago.
