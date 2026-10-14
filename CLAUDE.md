# Mostrador

Sistema de gestión en la nube para kioscos. La especificación completa está en `docs/SPEC.md`
y las decisiones técnicas en `docs/decisiones/`. Se trabaja por etapas (sección 22): no se
arranca una etapa hasta que la anterior cumple su "Listo cuando".

## Comandos

```sh
pnpm install --frozen-lockfile
docker compose -f infra/compose.dev.yml --env-file .env up -d   # PostgreSQL 16 y Redis
pnpm db:migrar            # migraciones (DATABASE_ADMIN_URL, MOSTRADOR_APP_PASSWORD)
pnpm db:semillas          # dos kioscos de prueba (A y B)
pnpm dev:web              # PWA en http://localhost:5173
pnpm dev:api              # API en http://127.0.0.1:3000 (DATABASE_URL, APP_ORIGEN, MOSTRADOR_CLAVES)
pnpm --filter @mostrador/worker dev   # worker de Mercado Pago (REDIS_URL)
pnpm --filter @mostrador/admin dev    # panel admin (DATABASE_PANEL_URL, PANEL_ORIGEN)

pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                 # unidad e integración (TEST_DATABASE_ADMIN_URL, PostgreSQL real)
pnpm contraste            # contraste de los tokens de los siete temas
pnpm e2e                  # Playwright: 4 tamaños × 7 temas, con axe
```

Copiá `.env.example` a `.env`. Node 22 corre TypeScript directo (sin compilar): los imports
locales llevan la extensión `.ts`/`.tsx` y solo se usa sintaxis borrable (nada de `enum`).

## Estructura

- `apps/web` PWA (React + Vite + Workbox + Dexie). `apps/api` API Fastify. `apps/worker` trabajos
  BullMQ de Mercado Pago. `apps/admin` panel interno (solo Tailscale).
- `packages/shared` UUIDv7, plata, precios, CSV, búsqueda, caja, balanza y lector.
  `packages/db` migraciones SQL, roles, RLS, `withKiosco`/`sinKiosco`, `moverStock`, semillas.
  `packages/ui` tokens de tema, fuentes propias y componentes base. `packages/servidor`
  contraseñas, TOTP, tokens y cifrado. `packages/mp` cliente de Mercado Pago, firma, PKCE y
  aplicación de órdenes.
- `infra/` Dockerfile, Compose de desarrollo y producción, Caddyfile, firewall y respaldos.
  Guía de producción en `docs/DEPLOY.md`.

## Reglas no negociables (resumen de la sección 18)

1. **Aislamiento:** RLS forzada en toda tabla de negocio. El `kiosco_id` sale solo de la sesión
   y se fija por transacción con `set_config('app.kiosco_id', …, true)` vía `withKiosco`, la
   única forma de hablar con la base desde las rutas. FK compuestas `(kiosco_id, x_id)`. La
   prueba de aislamiento corre en cada CI y toda ruta nueva entra en
   `apps/api/test/casos-aislamiento.ts`.
2. **Permisos en el servidor** en cada ruta, deniego por defecto (solo `config.publica` pasa sin
   sesión). Esquemas zod `strict()`: un campo de más se rechaza.
3. **Nada de SQL armado con strings.** Solo consultas parametrizadas (Kysely o `pg`).
4. **Prohibido `dangerouslySetInnerHTML`** y cualquier HTML sin escapar.
5. **Secretos fuera del repo y de los logs** (redacción de tokens, cookies, contraseñas, PIN,
   emails y CUIT).
6. **Tokens de Mercado Pago cifrados** con clave fuera de la base; nunca al cliente.
7. **Webhooks:** firma verificada **y** reconsulta a la API antes de cambiar un estado.
8. **Argon2id**, segundo factor obligatorio para dueño y encargado, PIN solo en dispositivos
   registrados y con límite de intentos.
9. **Cobros idempotentes** y una sola transacción para venta, stock y pago. Ante la duda, falla
   cerrada.
10. **Encabezados:** CSP estricta (`default-src 'self'`, sin scripts en línea), HSTS, nosniff,
    Referrer-Policy y Permissions-Policy (cámara solo `self`).
11. **CORS** con lista exacta de orígenes.
12. **Límite de pedidos** estricto en login, PIN, invitaciones y webhooks.
13. **Auditoría** de accesos, roles, dispositivos, exportaciones, anulaciones, aumentos
    masivos, Mercado Pago y todo acceso de soporte.
14. **Errores genéricos** al usuario, detalle en logs con ID de correlación.
15. **Dependencias:** lockfile, `--frozen-lockfile`, `pnpm audit`, pocas dependencias, imágenes
    y actions fijadas por digest.
16. **Datos en el dispositivo:** solo catálogo, turno y ventas pendientes. Se borran al cerrar
    sesión.

## Convenciones

- Plata en centavos (`bigint` en la base, `number` entero en JS). Nunca float.
- IDs UUIDv7 generados en la app (`@mostrador/shared`). Nada de IDs autoincrementales en URLs.
- Interfaz en castellano rioplatense, con voseo, sin jerga técnica. Estados siempre en palabras.
- Colores solo con tokens (`packages/ui/src/temas.css`). Permanent Marker solo en el total y
  solo en el estilo kiosco.
- Rubros (`docs/decisiones/009-rubros.md`): el rubro del comercio define el estilo (`kiosco` o
  `sobrio`, atributo `data-estilo`) y las funciones (`kioscos.modulos`, `useNegocio().tiene()`).
  Una ferretería no se ve como un kiosco.
- Cada pantalla se hace en los tres tamaños (celular, tablet, PC) y en los temas de su estilo
  (Noche, Día, Pizarrón y Alto contraste; Claro, Grafito, Boutique y Alto contraste).

## Preguntar antes de

Agregar una dependencia grande, cambiar el modelo de datos de forma incompatible, tocar
políticas RLS o roles de base, o guardar un dato personal nuevo.
