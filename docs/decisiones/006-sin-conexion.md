# 006. Modo sin conexión: un solo camino para vender, con y sin internet

**Fecha:** octubre de 2026 · **Etapas:** D y E

## Decisión

1. **Toda venta pasa por la bandeja de salida**, haya o no conexión. La venta, el gasto y la
   apertura de caja se guardan primero en IndexedDB (Dexie) con un UUIDv7 generado en el equipo y
   se suben con `POST /api/v1/sync`. Con conexión se suben en el acto; sin conexión, cuando vuelve
   (evento `online`, o reintento con espera creciente de 2 s a 60 s). No hay un camino "en línea"
   distinto que pueda comportarse diferente.
2. **Idempotencia en el servidor**: cada operación se busca por su ID antes de insertarse; si ya
   está responde `ya_existia`. Cada operación va en su propio savepoint: una rechazada no frena a
   las demás ni deja nada a medias. Las rechazadas quedan en el equipo (no se borran) y se avisa.
3. **Turno compartido**: si un equipo abre la caja sin conexión y al subir ya había otro turno
   abierto, el servidor responde el turno existente y el equipo reasigna sus operaciones
   pendientes a ese turno (V1: un turno compartido por kiosco, sección 24).
4. **Cierre de caja solo con conexión**: antes de cerrar se sube la bandeja; si queda algo sin
   subir, no se deja cerrar (sección 10).
5. **Sesión sin conexión**: se guarda una copia mínima de la sesión (kiosco, nombre y rol, sin
   tokens) para abrir la app sin internet. La cookie sigue siendo la que autentica cuando vuelve la
   red. El cajero tiene bloqueo de pantalla a los 5 minutos que se destraba con su PIN contra un
   hash PBKDF2 local (200.000 iteraciones). Cinco fallas cierran la sesión.
6. **Service worker** con `vite-plugin-pwa` (Workbox, `generateSW`): guarda la app, las fuentes y
   los íconos; nunca la API. Registro en modo `prompt`: la app no se recarga sola; avisa "Hay una
   versión nueva" y se aplica al tocar (con el ticket vacío) o al cerrar la caja.
7. **Al cerrar sesión** se borran catálogo, turno y ticket del kiosco en ese equipo; con ventas sin
   subir, no se deja cerrar.

## Alternativas

- **Background Sync del service worker**: no está en Safari ni en Firefox y complica las pruebas.
  El reintento desde la página alcanza porque la app está abierta mientras se vende.
