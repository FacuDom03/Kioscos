# 005. Login con funciones de sistema, sesiones en PostgreSQL y panel aparte

**Fecha:** octubre de 2026 · **Etapa:** B

## Contexto

La RLS falla cerrada: sin `app.kiosco_id` no se ve nada. Pero el login, las invitaciones, el PIN
del cajero y la lectura de la sesión pasan **antes** de saber el kiosco. La decisión 002 dejó esto
pendiente. Toca roles y RLS, así que se registra acá.

## Decisión

1. **Rol `mostrador_sistema`** (sin login, con `BYPASSRLS`), dueño de un conjunto chico de funciones
   `security definer` con `search_path` fijo:
   - `auth_*`: credenciales por email, intentos fallidos y bloqueo, sesiones, invitaciones,
     dispositivos por credencial, passkeys y segundo factor.
   - `kiosco_*`: alta de cajeros e invitaciones **del kiosco de la sesión** (usan `app_kiosco_id()`),
     con el límite de usuarios del plan validado en la base.
   - `panel_*`: solo para el panel.
     El rol de la API (`mostrador_app`) solo puede **ejecutar** `auth_*` y `kiosco_*`; no tiene ningún
     permiso sobre `sesiones`, `passkeys`, `admins` ni `sesiones_admin` (RLS forzada sin políticas).
2. **Sesiones en PostgreSQL** (tabla `sesiones`), no en Redis: una dependencia menos para la API y
   las pruebas. En la base solo está el hash SHA-256 del token; la cookie es `__Host-mostrador`,
   `HttpOnly`, `Secure`, `SameSite=Lax`. El token rota al completar el segundo factor y al cambiar de
   kiosco. Duraciones: pendiente 10 min; turno 12 h; dueño 30 min de inactividad (tope 12 h).
   `auth_leer_sesion` vuelve a validar membresía, kiosco y dispositivo en cada pedido: si el dueño
   desactiva a alguien o revoca un equipo, la sesión se corta en el acto.
3. **Segundo factor**: passkey (SimpleWebAuthn) o TOTP propio (RFC 6238, sin dependencia). Secretos
   TOTP cifrados con libsodium (`crypto_secretbox`) y la clave versionada fuera de la base. Diez
   códigos de recuperación (se guarda su hash). La passkey es la opción principal en la interfaz
   (decisión pendiente de la sección 24: se ofrecen las dos).
4. **Cajeros sin email**: `usuarios.email` pasa a ser opcional. El cajero entra con PIN (Argon2id,
   5 intentos y espera creciente) solo desde un equipo con la cookie `__Host-mostrador-equipo`
   (credencial aleatoria; en la base, su hash).
5. **Panel admin aparte** (`apps/admin`): otro proceso, otro rol de base (`mostrador_panel`, que solo
   ejecuta `panel_*`), login con contraseña y TOTP obligatorio, escucha solo en la IP de Tailscale.
   Las invitaciones se mandan por WhatsApp con un enlace `/invitacion#token` (el token va en el
   fragmento: no llega a logs ni a proxies). No hace falta servidor de email.
6. **Soporte**: el panel solo puede crear una sesión de soporte si `kioscos.soporte_hasta` está en
   el futuro (lo prende el dueño, dura 24 h). Todo lo que no es lectura queda auditado con
   `es_soporte = true`, y el dueño lo ve en Más → Actividad.

## Alternativas

- **Abrir `usuarios` con una política por email:** expone la tabla entera a cualquier consulta sin
  kiosco. Peor que una función que devuelve solo lo necesario.
- **Sesiones en Redis:** más rápido, pero agrega Redis como dependencia dura del login.
