# 008. Infraestructura de producción

**Fecha:** octubre de 2026 · **Etapa:** H

## Decisión

1. **Una imagen para todo lo de Node** (`infra/Dockerfile`, destino `app`): API, worker, panel y
   migraciones comparten código y dependencias; cambia solo el comando. Node 22 corre el
   TypeScript directo (decisión 001), así que no hay paso de compilación del servidor. La PWA se
   compila y la sirve Caddy (destino `web`).
2. **Imágenes base desde `mirror.gcr.io`** (el espejo de Docker Hub de Google), fijadas por
   digest: mismas imágenes oficiales, sin el límite de descargas anónimas de Docker Hub que
   suele afectar a los VPS.
3. **Secretos en archivos** (`/opt/mostrador/secretos`, generados por `preparar-secretos.sh`) y
   montados como secrets de Compose. Un `entrypoint` (`con-secretos`) convierte cada variable
   `X_ARCHIVO` en `X` dentro del proceso. Nada de secretos en el repo ni en variables del compose.
4. **Contenedores endurecidos**: sistema de archivos de solo lectura, `no-new-privileges`, sin
   capabilities (Caddy solo `NET_BIND_SERVICE`), usuario `node`. PostgreSQL, Redis y el worker sin
   puertos publicados; el panel solo en la IP de Tailscale.
5. **Firewall** (`infra/firewall.sh`): ufw para el servidor y reglas en `DOCKER-USER` (Docker
   saltea ufw para los puertos publicados) para que el 443 acepte solo IPs de Cloudflare.
6. **HTTPS**: Cloudflare con SSL "Full (strict)" y certificado de origen de Cloudflare en Caddy.
   Caddy confía en `CF-Connecting-IP` solo desde rangos de Cloudflare; la API confía en Caddy
   (`TRUST_PROXY=1`) para el límite de pedidos y la auditoría.
7. **CSP estricta** en Caddy: `default-src 'self'`, sin `unsafe-inline` ni en scripts ni en
   estilos (React aplica estilos por CSSOM, que la CSP no bloquea), cámara solo `self`.
8. **Respaldos**: WAL archivado cada 5 minutos + copia base y copia lógica diarias, cifrado con age
   (clave privada fuera del servidor) y subido con rclone a otro proveedor; 30 días; restauración
   probada con `probar-restauracion.sh`. Probado en el entorno de desarrollo contra el stack de
   producción levantado con Compose.

## Verificado

En el entorno de desarrollo se levantó `compose.prod.yml` completo: migraciones, API sana,
encabezados de seguridad, PWA y API detrás de Caddy, `/health` sin publicar, panel, alta de kiosco
desde el panel, invitación, TOTP, apertura de caja, producto, venta con vuelto, sin errores de CSP,
y un respaldo cifrado restaurado en un PostgreSQL descartable.

## Pendiente (decisiones del dueño del proyecto, sección 24)

- Herramienta de seguimiento de errores (Sentry o GlitchTip) y proveedor de almacenamiento para
  respaldos. La guía usa UptimeRobot/Better Stack, Healthchecks.io y R2/B2 como ejemplos.
