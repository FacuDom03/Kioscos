# Mostrador: especificación para desarrollo

> Documento de traspaso para construir la versión 1 con Claude Code.
> "Mostrador" es el nombre de trabajo; el nombre comercial está pendiente.
> Fecha: octubre de 2026.

---

## 0. Cómo usar este documento (para Claude Code)

1. Leé el documento completo antes de escribir código.
2. Guardalo en el repo como `docs/SPEC.md` y creá un `CLAUDE.md` corto con las **reglas no negociables** de la sección 18 y los comandos del proyecto.
3. Trabajá por **etapas** (sección 22). No arranques una etapa hasta que la anterior cumpla su "Listo cuando".
4. Cada pantalla se hace **desde el principio en los tres tamaños** (celular, tablet y computadora) y con los **tokens de tema** (sección 16). La versión para PC no se deja para el final.
5. Para Mercado Pago, lo de la sección 13 es el diseño, no la fuente de verdad de la API. **Antes de programar la integración, leé la documentación oficial vigente** (links en la sección 25) y ajustá endpoints y nombres de campos.
6. Preguntá antes de: agregar una dependencia grande, cambiar el modelo de datos de forma incompatible, tocar políticas RLS o roles de base, o guardar un dato personal nuevo.
7. Registrá cada decisión técnica importante en `docs/decisiones/NNN-titulo.md` (contexto, decisión, alternativas).

---

## 1. Qué es Mostrador

Un sistema de gestión en la nube para kioscos, almacenes y comercios de barrio del conurbano bonaerense. Se vende puerta a puerta, con prueba gratis de 30 días y soporte por WhatsApp.

Lo usa el dueño o el cajero, apurado, con un celular en la mano o en la PC del mostrador, bajo luz de tubo o con sol en la vidriera. Por eso la app **abre directo en la pantalla de venta**, y lo más visible siempre es el **total a cobrar**.

Principios del producto:

- **Vender nunca se frena.** Sin internet se sigue vendiendo en efectivo y las ventas se suben después.
- **El menor control posible sobre las cuentas del comercio.** Mercado Pago se conecta por OAuth y solo se usa para confirmar cobros con QR. Nunca se guardan contraseñas del comercio ni se mueve su plata.
- **Cada kiosco aislado.** Un kiosco jamás puede ver datos de otro, y eso lo garantiza la base de datos, no solo el código.
- **Configuración fácil.** Cada conexión tiene su paso a paso dentro de la app.

---

## 2. Alcance de la versión 1

### Incluye

- Venta con ticket: lector de código de barras (USB o cámara), búsqueda, productos más vendidos y producto sin código con precio libre.
- Cobro en **efectivo** (con cálculo del vuelto), **QR de Mercado Pago** (confirmado al instante) y **transferencia** (confirmación manual).
- Stock: catálogo, código de barras, categorías, mínimo por producto, alerta "Por reponer", carga de compras (ingreso de mercadería con costo) y aumento masivo de precios.
- Caja: apertura con cambio inicial, gastos y retiros, cierre de turno con conteo y diferencia.
- Modo sin conexión (PWA) con cola de sincronización.
- Conexiones: Mercado Pago, estado de la copia en la nube y acceso de soporte por 24 horas.
- Apariencia: cuatro temas a elección (Noche, Día, Pizarrón y Alto contraste).
- Funciona en **celular, tablet y computadora**, con atajos de teclado e impresión de ticket en impresora térmica.
- Usuarios y roles: dueño, encargado y cajero (con PIN en dispositivos registrados).
- Exportar ventas y compras en CSV para el contador, y exportar o borrar todos los datos del kiosco.
- Panel interno de administración (solo para el dueño del SaaS): alta de kioscos, planes y estado de la suscripción.

### No incluye (queda para después)

| Módulo | Cuándo |
|---|---|
| Proveedores y fiado (cuentas corrientes) | Fase 2 |
| Informe mensual automático (n8n) | Fase 2 |
| Guías extendidas dentro de la app | Fase 2 |
| Devolución de cobros QR por API | Fase 2 |
| Facturación electrónica ARCA (Afip SDK) | Fase 3 |
| Base de clientes y promos por WhatsApp | Fase 3 |
| Sucursales | Fase 3 |
| App en Play Store | Fase 3 |
| Contabilidad, retenciones, Libro IVA y tienda online | Fuera del producto |
| Alta de cuentas por autoservicio | Fuera de la V1: las cuentas las crea el admin después de la visita |

### Planes (hipótesis a validar)

| | Esencial | Comercio |
|---|---|---|
| Precio | ARS 20.000/mes | ARS 30.000/mes |
| Ventas, stock, caja, QR y modo sin conexión | Sí | Sí |
| Proveedores y fiado (fase 2) | No | Sí |
| Usuarios | 1 | 3 |

Los límites de cada plan se validan **en el servidor**, nunca solo en la interfaz.

---

## 3. Usuarios, roles y permisos

| Rol | Puede |
|---|---|
| **Dueño** | Todo: precios, stock, usuarios, dispositivos, conexiones, exportar, borrar la cuenta, anular ventas, ver cierres de caja. |
| **Encargado** | Vender, cobrar, cargar compras, ajustar stock, abrir y cerrar caja, anular ventas del día. No toca usuarios, conexiones ni exportaciones. |
| **Cajero** | Vender, cobrar, registrar gastos del turno, abrir y cerrar su caja. No ve costos ni márgenes ni cierres anteriores. |
| **Soporte** (vos) | Nada por defecto. Solo cuando el dueño activa "Acceso de soporte" (dura 24 horas), y cada acción queda auditada y visible para el dueño. |

- Los permisos se verifican **en el servidor, en cada ruta**, con un deniego por defecto.
- Una persona puede tener membresía en más de un kiosco (tabla `membresias`).

---

## 4. Dispositivos: celular, tablet y computadora

Los tres son de primera categoría. La PC del mostrador es muy común en kioscos y suele tener lector USB e impresora térmica.

### 4.1 Tamaños y diseño

| Tamaño | Ancho | Diseño de "Vender" | Navegación |
|---|---|---|---|
| Celular | < 600 px | Una columna (mockup 390×844) | Barra abajo: Vender, Stock, Caja, Más |
| Tablet | 600 a 1023 px | Dos columnas: productos a la izquierda, ticket y total a la derecha (mockup 1024×768) | Barra abajo |
| Computadora | ≥ 1024 px con puntero fino | Dos columnas como la tablet, con atajos de teclado visibles | Barra lateral izquierda (íconos y texto) con el estado de conexión abajo |

- Resoluciones mínimas que tienen que entrar **sin scroll** en Vender: 360×640 (celular), 1024×768 (tablet) y **1366×768** (notebook típica de mostrador).
- En PC, Stock y Caja usan **tablas** (ordenables y navegables con teclado) en lugar de tarjetas.
- En PC, el cobro abre en el **panel derecho** en lugar de ocupar toda la pantalla. El QR mide 260 px como mínimo para que el cliente lo escanee desde el otro lado del mostrador.
- La tablet y la PC se detectan por ancho **y** por `(pointer: fine)` / `(hover: hover)`. Una tablet con teclado Bluetooth también muestra los atajos.

### 4.2 Teclado (PC)

Todo el flujo de venta se tiene que poder hacer **sin mouse**. Después de cada acción, el foco vuelve al buscador.

| Tecla | Acción |
|---|---|
| `F2` | Ir al buscador |
| `Enter` en el buscador | Si es un código exacto, suma el producto. Si es texto, abre resultados y suma el primero. |
| `3*` y después escanear o `Enter` | Suma 3 unidades |
| `↑` `↓` | Moverse por resultados o por los ítems del ticket |
| `+` / `-` | Sumar o restar una unidad al ítem seleccionado |
| `Supr` | Quitar el ítem seleccionado |
| `F4` | Producto sin código (precio libre) |
| `F7` | Cobrar con transferencia |
| `F8` | Cobrar en efectivo |
| `F9` | Cobrar con QR |
| `Esc` | Cancelar o volver. Vaciar el ticket pide confirmación. |

- **No usar** F1, F3, F5, F6, F11 ni F12 (son del navegador). Las teclas usadas llevan `preventDefault()`. Probar en Chrome y Edge sobre Windows.
- Cada botón muestra su atajo (por ejemplo, "Cobrar en efectivo · F8") solo cuando hay teclado físico.

### 4.3 Instalación en PC

- Se instala como app desde Chrome o Edge ("Instalar Mostrador") y abre en su propia ventana.
- Soportado: Windows 10 y 11, Linux y ChromeOS con Chrome o Edge actualizados. Windows 7 y 8 no reciben Chrome actualizado, así que no se soportan.
- Safari y Firefox: la app tiene que funcionar, pero la instalación y algunas funciones (como el escaneo con cámara) pueden no estar disponibles. Mostrar un aviso claro.

---

## 5. Stack y arquitectura

| Capa | Elección | Por qué |
|---|---|---|
| App | React + TypeScript, PWA con Vite y Workbox | Un solo código para celular, tablet y PC; se instala con un ícono y se actualiza sin tienda. |
| Modo sin conexión | IndexedDB con Dexie y una cola de sincronización | En un kiosco se corta internet; la venta se guarda y se sube después. |
| API | Node.js + TypeScript con Fastify, validación con zod | Mismo lenguaje que la app; el SDK de Afip SDK es de Node para el módulo futuro. |
| Acceso a datos | Kysely sobre `pg` (consultas tipadas y parametrizadas) | Control explícito de transacciones, necesario para RLS. Evitar ORMs que oculten la conexión. |
| Base | PostgreSQL 16 o superior, con RLS | El aislamiento por kiosco lo fuerza la propia base. |
| Colas | Redis + BullMQ | Webhooks, reconsultas a Mercado Pago e informes, con reintentos y sin frenar la caja. |
| Proxy | Caddy detrás de Cloudflare | HTTPS automático, WAF y límite de pedidos. |
| Automatización | n8n autoalojado, solo red interna (fase 2) | Informe mensual; uso interno dentro de su licencia gratuita. |
| Infraestructura | VPS Hostinger KVM 4, Ubuntu LTS, Docker Compose | Un servidor alcanza para los primeros cientos de kioscos. |

```
 Kiosco (PWA: celular / tablet / PC)
        │ HTTPS
   Cloudflare (WAF, rate limit)
        │ solo 443, solo IPs de Cloudflare
   Caddy ──► web (archivos estáticos de la PWA)
        └──► api (Fastify) ──► PostgreSQL (RLS)
                   │        └─► Redis ◄── worker (BullMQ)
                   │                          │
   Mercado Pago ◄──┴──────────────────────────┘  (OAuth, órdenes QR, reconsulta)
   Mercado Pago ──► webhook ──► api ──► cola ──► worker

 Red interna (sin puertos públicos): PostgreSQL, Redis, n8n
 Panel admin y SSH: solo por Tailscale, con MFA
```

---

## 6. Estructura del repositorio

```
mostrador/
  apps/
    web/          PWA (React + Vite + Workbox + Dexie)
    api/          API Fastify
    worker/       Trabajos BullMQ (webhooks MP, reconsultas, limpieza)
    admin/        Panel interno (solo Tailscale)
  packages/
    shared/       Esquemas zod, tipos, dinero, fechas, UUIDv7
    db/           Migraciones SQL, roles, políticas RLS, seeds de prueba
    ui/           Tokens de tema, tipografías y componentes base
  infra/
    compose.dev.yml
    compose.prod.yml
    Caddyfile
    backup/       Scripts de backup y restauración
  docs/
    SPEC.md       Este documento
    decisiones/   Registro de decisiones
  CLAUDE.md
```

- pnpm workspaces, TypeScript en modo `strict`, ESLint y Prettier.
- Pruebas: Vitest (unidad e integración contra un PostgreSQL real) y Playwright (de punta a punta).
- CI en GitHub Actions: lint, tipos, pruebas, `pnpm audit`, build de imágenes fijadas por digest.
- Migraciones en SQL plano y versionadas. Nada de `synchronize` automático.

---

## 7. Modelo de datos

Convenciones:

- **IDs UUIDv7** en todas las tablas, generados en la app (`packages/shared`). Las ventas se generan **en el dispositivo** para que funcionen sin conexión.
- **Plata en centavos**, `bigint`. Nunca `float`. Se muestra como `$ 1.500` (formato es-AR, sin decimales si son cero).
- Toda tabla de negocio lleva `kiosco_id uuid not null` con clave foránea e índice compuesto `(kiosco_id, …)`.
- `created_at`/`updated_at` en `timestamptz`. Las ventas guardan además `creada_en_dispositivo` (hora del equipo) y `recibida_en` (hora del servidor).

| Tabla | Qué guarda | Notas |
|---|---|---|
| `kioscos` | Nombre, CUIT (opcional), plan, estado de la suscripción, `soporte_hasta` | CUIT es dato sensible |
| `usuarios` | Email, hash Argon2id, segundo factor | No lleva `kiosco_id`; se accede por `membresias` |
| `membresias` | Usuario, kiosco y rol | |
| `dispositivos` | Equipos autorizados, nombre ("PC mostrador"), credencial de dispositivo (hash), último uso | El PIN de cajero solo funciona en un dispositivo registrado |
| `pines` | PIN de cajero (hash) por membresía | |
| `cajas` | Cajas del kiosco (V1: una por kiosco) | Preparado para más de una |
| `categorias` | Nombre y orden | |
| `productos` | Nombre, códigos de barras, precio, costo, stock actual, mínimo, categoría, activo | `stock_actual` se actualiza en la misma transacción que el movimiento |
| `codigos_barra` | Código (EAN-13, EAN-8, UPC, interno) y producto | Único por kiosco |
| `movimientos_stock` | Tipo (venta, compra, ajuste, anulación), cantidad, costo, referencia | Solo se agregan filas; nunca se editan |
| `compras`, `compra_items` | Ingreso de mercadería con costo (el proveedor queda opcional hasta la fase 2) | |
| `cambios_precio` | Aumentos masivos: criterio, porcentaje, redondeo y quién lo hizo | Permite deshacer |
| `turnos_caja` | Caja, quién abre y cierra, cambio inicial, esperado, contado, diferencia, nota | |
| `gastos` | Turno, monto, motivo, tipo (gasto o retiro) | |
| `ventas` | Turno, usuario, dispositivo, total, estado (abierta, cobrada, pendiente_cobro, anulada) | Su `id` sale del dispositivo (idempotencia) |
| `venta_items` | Producto, descripción, cantidad, precio unitario al momento, subtotal | El precio queda congelado en la venta |
| `pagos` | Venta, medio (efectivo, qr_mp, transferencia), monto, recibido, vuelto, estado, IDs de orden y de pago de Mercado Pago | Una venta puede tener más de un pago |
| `integraciones` | Proveedor, estado, `user_id` de MP, tokens **cifrados**, vencimiento, IDs de sucursal y caja en MP | Nunca viaja al cliente |
| `eventos_webhook` | ID del evento, recibido, procesado, resultado | Para no procesar dos veces |
| `auditoria` | Quién, qué, cuándo, IP, kiosco | Solo se agregan filas; el rol de la API no puede editar ni borrar |

Tablas que **no** se crean en la V1: `clientes`, `consentimientos`, `comprobantes`, `proveedores`.

---

## 8. Aislamiento entre kioscos (RLS)

El riesgo más grave del producto es que un kiosco vea datos de otro. El aislamiento no puede depender de que el código se acuerde de filtrar.

**Roles de base de datos**

- `mostrador_owner`: dueño de las tablas, sin login. Lo usan solo las migraciones.
- `mostrador_app`: rol de la API. No es dueño, no tiene `BYPASSRLS` y solo tiene los permisos mínimos por tabla (por ejemplo, `auditoria` solo `INSERT` y `SELECT`).
- `mostrador_reportes` (fase 2): solo `SELECT` sobre vistas del esquema `reportes`, también sujeto a RLS.

**Política tipo** (una por tabla de negocio):

```sql
alter table ventas enable row level security;
alter table ventas force row level security;

create policy aislamiento_kiosco on ventas
  using (kiosco_id = nullif(current_setting('app.kiosco_id', true), '')::uuid)
  with check (kiosco_id = nullif(current_setting('app.kiosco_id', true), '')::uuid);
```

- Si `app.kiosco_id` no está fijado, la consulta no devuelve nada (falla cerrada).
- El `kiosco_id` sale **siempre de la sesión verificada en el servidor**, nunca del cuerpo, la URL ni un header.
- Se fija **por transacción**: cada request abre una transacción y ejecuta `select set_config('app.kiosco_id', $1, true)` antes de cualquier consulta. Así no pasa a otra request que reuse la conexión del pool.
- Un helper único `withKiosco(kioscoId, fn)` es la única forma de hablar con la base desde las rutas. Agregá una regla de lint o una prueba que falle si una ruta usa el pool directo.
- Claves de Redis y nombres de trabajos con prefijo `kiosco:<id>:`.

**Prueba obligatoria en CI:** dos kioscos de prueba (A y B) con datos. Un test recorre **todas** las rutas de la API autenticado como A e intenta leer, editar y borrar recursos de B por ID. Todas tienen que dar 404 y la base no tiene que cambiar. Además hay una prueba directa en SQL: con `app.kiosco_id` de A, `select count(*)` sobre cada tabla de negocio no devuelve filas de B.

---

## 9. Autenticación y sesiones

- **Alta de cuentas:** solo desde el panel admin. Se crea el kiosco y se manda al dueño un enlace de invitación de un solo uso que vence en 72 horas.
- **Dueño y encargado:** email + contraseña (Argon2id) + **segundo factor obligatorio**. Opción principal: passkey (huella o PIN del celular o Windows Hello). Respaldo: TOTP. Al activarlo se generan códigos de recuperación.
- **Cajero:** PIN de 4 a 6 dígitos, válido **solo en un dispositivo registrado** por el dueño. Máximo 5 intentos y después bloqueo con espera creciente.
- **Registro de dispositivo:** el dueño, ya autenticado, toca "Autorizar este equipo". Se crea una credencial aleatoria que el equipo guarda; en la base queda solo su hash.
- **Sesiones en el servidor** (tabla o Redis) con cookie `HttpOnly`, `Secure`, `SameSite=Lax`. La sesión de un turno dura como máximo 12 horas; la del dueño fuera de la caja, 30 minutos de inactividad.
- **CSRF:** cookies `SameSite` y verificación del header `Origin` en todo lo que modifica datos.
- **Sin conexión:** la app sigue funcionando con la sesión que ya tenía. El bloqueo de pantalla por inactividad se destraba con el PIN contra un hash local (PBKDF2 con WebCrypto). Es solo un bloqueo de pantalla, no autentica contra el servidor.
- Los mensajes de error de login son siempre iguales ("Email, contraseña o código incorrectos").
- Al cerrar sesión se borran los datos locales del kiosco en ese equipo, salvo las ventas sin subir: en ese caso se avisa y no se deja cerrar hasta sincronizar.

---

## 10. Ventas y caja

**Venta**

- Una venta nace "abierta" en el dispositivo, con un UUIDv7.
- Sumar el mismo producto incrementa la cantidad, no agrega una línea nueva.
- "Producto sin código" pide un monto y opcionalmente una descripción.
- **Balanza (si un piloto la tiene):** los EAN-13 que empiezan con 20 a 29 se interpretan según un formato configurable (código de producto de 5 dígitos más precio o peso de 5 dígitos).
- La venta, sus ítems, el movimiento de stock y el pago se guardan **en una sola transacción**. Ante cualquier error no queda nada a medias.
- El stock puede quedar negativo. Se avisa, pero no se frena la venta.

**Cobro**

- **Efectivo:** se ingresa con cuánto paga el cliente (con botones rápidos de $ 1.000, $ 2.000, $ 10.000, $ 20.000 y "Justo"), y la app muestra el vuelto bien grande.
- **QR de Mercado Pago:** ver sección 13. Necesita internet.
- **Transferencia:** el cajero confirma a mano "Transferencia recibida". En la V1 no se verifica contra el banco.
- Venta cobrada: pantalla "Cobrado", con opciones "Nueva venta" e "Imprimir ticket".

**Anulación**

- Solo dueño y encargado (el encargado, solo las del día). Pide un motivo.
- Revierte el stock con un movimiento de tipo "anulación".
- Si fue con QR, en la V1 la devolución se hace desde la app de Mercado Pago. La venta queda como "anulada, devolución pendiente" hasta que el dueño la marca como devuelta. La devolución por API llega en la fase 2.

**Caja**

- **Abrir caja:** cambio inicial. Si hay internet, varios equipos del mismo kiosco (por ejemplo, la PC y el celular del dueño) pueden vender dentro del mismo turno.
- **Gastos y retiros:** monto y motivo, con la hora.
- **Cerrar caja:**
  - Se muestra el total vendido y la división por medio de pago: efectivo, QR y transferencia.
  - El cálculo es: cambio inicial + efectivo cobrado − gastos y retiros = **debería haber**.
  - El cajero ingresa lo que contó y se muestra la diferencia en palabras: "Faltan $ 500", "Sobran $ 200" o "Da justo".
  - Si hay diferencia, se puede agregar una nota.
- No se puede cerrar la caja con ventas sin sincronizar. Se avisa y se ofrece reintentar.

---

## 11. Stock

- Lista con buscador y filtros "Todos" y "Por reponer" (stock ≤ mínimo).
- Cada producto muestra stock actual, mínimo y una barra de nivel. "Sin stock" se muestra en rojo y en palabras.
- **Cargar compra:** escanear o buscar productos, cantidad y costo. Opcionalmente actualiza el precio de venta según un margen.
- **Ajuste de stock:** con motivo (rotura, vencido, conteo).
- **Aumento masivo de precios:** se elige el alcance (todo, una categoría o una selección), el porcentaje y el redondeo (al $ 10, $ 50 o $ 100 más cercano). Se ve una **vista previa con antes y después** antes de aplicar. Queda registrado y se puede deshacer.
- **Alta rápida:** si se escanea un código desconocido durante una venta, se ofrece "Cargar producto" con el código ya puesto (solo dueño y encargado). El cajero puede venderlo como precio libre.
- Editar el catálogo requiere conexión en la V1. Sin conexión solo se vende.

---

## 12. Modo sin conexión y sincronización

- **Service worker (Workbox):** guarda la app completa en caché. Las llamadas a la API no se cachean en el service worker; los datos van a Dexie.
- **Dexie (IndexedDB)** guarda:
  - el catálogo del kiosco (productos, códigos, categorías y precios), que se refresca al abrir la app, al volver el foco, cada 5 minutos y después de cada sincronización;
  - el turno abierto;
  - la **bandeja de salida** con ventas, gastos y cierres pendientes.
- **Sincronización:** `POST /api/v1/sync` con un lote de operaciones. Cada operación tiene su UUID, así que reenviarla nunca duplica nada (el servidor responde "ya existía"). Si falla, reintenta con espera creciente.
- **Reglas:**
  - Sin internet se vende **solo en efectivo**. QR deshabilitado con el texto "Cobrar con QR (necesita internet)".
  - El precio de la venta es el que había en el equipo al vender.
  - Si el stock queda negativo al sincronizar, se avisa al dueño.
- **Interfaz:** siempre visible y en palabras.
  - Con conexión, "En línea".
  - Sin conexión, el banner "Sin internet. Seguí vendiendo, las ventas se suben solas cuando vuelva." con el contador "N ventas esperando".
  - Cuando vuelve la conexión, "Listo, se subieron N ventas".
- **Actualizaciones de la app:** nunca se recarga sola con un ticket abierto. Se avisa "Hay una versión nueva" y se aplica al tocar o al cerrar la caja.
- **Probar:** cortar la red a mitad de una venta, cerrar la pestaña con ventas pendientes, dos equipos vendiendo el último producto, el reloj del equipo atrasado y el mismo lote enviado dos veces.

---

## 13. Mercado Pago

> ⚠️ Confirmar endpoints, campos y estados en la documentación oficial antes de programar (sección 25). Esto es el diseño.

### 13.1 Conexión (OAuth con PKCE)

1. En Conexiones, el dueño toca "Conectar Mercado Pago".
2. La API genera `state` (aleatorio, de un solo uso, ligado a la sesión, vence en 10 minutos) y `code_verifier`/`code_challenge` (S256). Redirige a la URL de autorización de Mercado Pago.
3. El callback verifica `state`, cambia el `code` por tokens en el servidor (con `code_verifier` y el `client_secret` de la app) y guarda `access_token`, `refresh_token`, vencimiento y `user_id` **cifrados** (ver 13.4).
4. Con el token del vendedor se crean (o se reusan si ya existen) la **sucursal** y la **caja** de Mercado Pago que necesita el cobro con QR, con un `external_pos_id` estable por kiosco.
5. La tarjeta queda en "Conectado".

- **Renovación:** un trabajo diario renueva los tokens que vencen en menos de 30 días (según el `expires_in` recibido). Si falla porque el vendedor revocó el acceso, la tarjeta pasa a "Requiere atención: volvé a conectar" y se avisa al dueño.
- **Desconectar:** borra los tokens y le explica al dueño cómo quitar el permiso desde su cuenta de Mercado Pago.
- **"Probar un cobro":** en la V1 verifica la conexión (token válido y caja creada) **sin mover plata**. Conviene renombrarlo "Probar conexión".

### 13.2 Cobro con QR (API de Orders)

1. El cajero elige "QR". La API crea una orden de tipo QR en modo dinámico con el monto total, `external_reference` igual al `id` de la venta y la caja del kiosco. Manda un `X-Idempotency-Key` derivado del `id` del pago, así que reintentar no crea dos órdenes.
2. La API devuelve al cliente **solo** el dato del QR. La app dibuja el QR localmente con una librería, sin cargar imágenes de terceros.
3. Mientras la pantalla de cobro está abierta, la app consulta `GET /api/v1/pagos/:id` cada 2 segundos. El estado lo actualiza el servidor (webhook y reconsulta), nunca el cliente.
4. Al confirmarse, la venta pasa a "cobrada" y se muestra "Cobrado: Mercado Pago confirmó el pago a las HH:MM".
5. "Cancelar cobro" cancela la orden en Mercado Pago.
6. La orden vence a los 10 minutos. Si no hay confirmación, la venta queda "pendiente de cobro" y el worker la sigue reconsultando por un tiempo. El dueño la ve en una lista para resolver.

### 13.3 Webhooks

- `POST /api/v1/webhooks/mercadopago` es la única ruta pública sin sesión.
- **Verificar la firma** del header `x-signature` (`ts` y `v1`). Se arma el manifiesto con el `data.id` de la query, el `x-request-id` y `ts`, y se calcula un HMAC-SHA256 con la clave secreta de webhooks de la app. La comparación es en tiempo constante. Se rechaza si `ts` es muy viejo. (Confirmar el formato exacto del manifiesto en la documentación.)
- Responder `200` rápido y encolar. El worker **vuelve a consultar la orden o el pago en la API** con el token del vendedor correspondiente, y solo ahí cambia el estado. **Nunca se confía en el cuerpo del webhook.**
- Guardar el ID del evento en `eventos_webhook` para no procesar dos veces.
- Verificar que el monto y el `external_reference` coincidan con la venta.

### 13.4 Cifrado de tokens

- Los tokens se cifran con libsodium (`crypto_secretbox`) y una clave maestra que vive en un archivo de secretos del servidor, **fuera de la base y del repo**.
- Versión de clave guardada junto al dato, para poder rotar.
- Los tokens nunca salen de la API: no van al cliente, a los logs ni a n8n.

### 13.5 Pruebas

- Todo se prueba primero en el entorno de pruebas de Mercado Pago, con **dos cuentas de vendedor distintas**, antes de conectar un kiosco real.
- Prueba explícita: con el kiosco A conectado a la cuenta 1 y el B a la cuenta 2, un pago de A nunca puede marcar una venta de B.

---

## 14. Lector de código de barras e impresión

### 14.1 Lector USB o Bluetooth (PC y tablet)

- Estos lectores "escriben" como un teclado: dígitos muy rápidos y al final `Enter`.
- Un **listener global** detecta ráfagas (menos de 35 ms entre teclas, 6 caracteres o más, termina en `Enter`) y manda el código al flujo de venta **aunque el foco no esté en el buscador**.
- Si el foco está en otro campo de texto (por ejemplo, el monto contado en Cerrar caja), no se intercepta.
- Código encontrado: suma al ticket con un sonido corto. Código desconocido: aviso "No encontramos el código 779…" con "Cargar producto" (dueño o encargado) o "Vender con precio libre".
- Formatos: EAN-13 (los argentinos empiezan con 779), EAN-8, UPC-A, UPC-E y Code 128.

### 14.2 Cámara (celular y tablet)

- Botón "Escanear". Usa la API `BarcodeDetector` donde exista y, si no, una librería de respaldo (por ejemplo ZXing).
- Escaneo continuo, con vibración y sonido al leer, e ignora el mismo código durante 1,5 segundos para no duplicar.
- Pedir permiso de cámara solo al tocar "Escanear", con una explicación previa.

### 14.3 Impresión de ticket

- Opcional: muchos kioscos no imprimen.
- Hojas de estilo de impresión para impresoras térmicas de **58 mm y 80 mm** (`@page { size: 58mm auto; margin: 0 }`), según la configuración del equipo.
- El ticket lleva: nombre del kiosco, fecha y hora, ítems, total, medio de pago, vuelto y el texto **"Documento no válido como factura"**.
- En PC se imprime con el diálogo del navegador. En la ayuda se explica cómo dejarla como impresora predeterminada y la opción de Chrome `--kiosk-printing` para imprimir sin diálogo.
- Fase 2: apertura del cajón de dinero e impresión directa (por ejemplo, con QZ Tray o WebUSB).

---

## 15. Pantallas

Hay un mockup de referencia en un artefacto privado de Claude (no accesible desde Claude Code). Esta sección lo describe completo.

### Elementos de marca comunes

- **Toldo:** franja superior de rayas con borde festoneado (semicírculos), como el toldo de un kiosco. En celular las rayas miden 26 px de ancho y 12 px de alto más el semicírculo; en tablet y PC, 32 px. Colores `--awning-a` / `--awning-b`.
- **Ticket térmico:** fondo `--paper` con el borde de abajo en zigzag (dientes de 14 px de ancho y 10 px de alto), separadores punteados y cantidades en un recuadro oscuro ("2×").
- **Cartel estrella del total:** polígono de estrella de 20 puntas (radio interior 0,84) en `--star`, contorno de 2,5 px en `--star-ink` y rotado −5°. Adentro dice "Total" en Bricolage y el monto en **Permanent Marker**. Es el **único lugar** donde se usa la letra de marcador.
- **Barra de navegación:** Vender, Stock, Caja y Más. El activo va en `--text` con una rayita de 3 px en `--action` arriba. Los inactivos van en `--text-soft`.

```ts
// Helpers del mockup (SVG)
function star(cx: number, cy: number, rx: number, ry: number, n: number, inner: number) {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? 1 : inner;
    pts.push(`${(cx + rx * r * Math.cos(a)).toFixed(1)},${(cy + ry * r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
function zig(w: number, t: number, h: number) {
  let d = 'M0 0';
  for (let x = 0; x < w; x += t) d += ` L${x + t / 2} ${h} L${x + t} 0`;
  return d + ' Z';
}
function awning(w: number, s: number, h: number, even: boolean) {
  let d = '';
  for (let i = 0; i * s < w; i++) {
    if ((i % 2 === 0) !== even) continue;
    const x = i * s;
    d += `M${x} 0H${x + s}V${h}A${s / 2} ${s / 2} 0 0 1 ${x} ${h}Z`;
  }
  return d;
}
// Venta celular: star(112, 64, 106, 60, 20, 0.84) en 224×128 · zig(358, 14, 10)
// Cobrar:        star(150, 84, 144, 80, 24, 0.86) en 300×168
// Tablet:        star(120, 68, 114, 64, 22, 0.85) · zig(340, 14, 10)
```

### 15.1 Vender (pantalla inicial)

- Encabezado: nombre del kiosco (28 px, peso 800, ancho 82 %), "Caja de Anita, turno mañana" y el estado "En línea" (pastilla con borde `--ok`).
- Buscador "Buscar producto" con ícono de lupa y botón "Escanear" (`--scan-bg`). En PC se reemplaza el botón por la pista "Escaneá o escribí · F2".
- "Más vendidos" (con la pista "Tocá para sumar al ticket"): grilla de 3 columnas en celular, 4 en tablet y de 4 a 6 en PC. Cada mosaico tiene el nombre (14 px) y el precio (22 px, peso 800, ancho 80 %, en `--price-ink` sobre `--price-bg`). El último mosaico, con borde punteado, es "Producto sin código / Precio libre".
- Tablet y PC: chips de categorías (Todo, Bebidas, Golosinas, Almacén, Varios).
- Ticket: "Ticket" con la cantidad de productos, y líneas con cantidad, nombre y subtotal. En tablet y PC el ticket va en la columna derecha, con botones + y − por línea.
- "Vaciar ticket" (texto subrayado), el cartel estrella con el total y el botón **"Cobrar"** (64 px de alto, `--action`, sombra interior abajo). En PC lo reemplazan tres botones: efectivo (F8), QR (F9) y transferencia (F7).

### 15.2 Cobrar

- Volver, título "Cobrar" y un cartel estrella grande con "Total a cobrar" y el monto (58 px).
- "¿Cómo paga?" con tres botones: Efectivo, QR y Transferencia. El elegido va con fondo claro y letra oscura.
- **QR:** tarjeta de papel con el QR de la orden, "Esperando el pago" con tres puntitos animados en `--ok` (respetar `prefers-reduced-motion`) y "Cancelar cobro".
- **Efectivo:** "¿Con cuánto paga?" con montos rápidos y el vuelto bien grande.
- **Sin internet:** QR deshabilitado con su explicación.

### 15.3 Cobrado

- Círculo con tilde en `--ok`, "Cobrado" (Bricolage, no marcador) y "Mercado Pago confirmó el pago a las HH:MM" (o "Cobrado en efectivo · Vuelto $ X").
- Ticket con el sello "PAGADO" en verde (`--stamp`).
- Botones "Nueva venta" (`--action`) e "Imprimir ticket".

### 15.4 Cerrar caja

- "Cierre de caja" y "Vendiste hoy $ 153.000".
- Barra apilada por medio de pago (efectivo, QR y transferencia) con una leyenda que tiene **texto y montos** (el color no es lo único que informa).
- Tarjeta de efectivo con cambio inicial, "+ Ventas en efectivo", "− Gastos y retiros" y "Debería haber".
- Campo "¿Cuánto contaste?". Si no coincide, va con borde `--danger` y el estado "Faltan $ 500." en rojo, con una nota opcional.
- Botón "Cerrar caja".

### 15.5 Stock

- "Stock" con el botón "Cargar compra", el buscador y los chips "Todos (214)" y "Por reponer (3)" (este último con un punto rojo).
- Tarjetas por producto (tabla en PC) con el stock en rojo si está bajo, "Mínimo 12" y una barra de nivel.
- Tarjeta "Aumento de un proveedor" con el botón "Aumentar precios" (abre el aumento masivo).

### 15.6 Más → Conexiones

- **Mercado Pago:** "Conectado" (o "Sin conectar" o "Requiere atención"), el texto "Confirma al instante los cobros con QR. Nunca vemos tu contraseña ni movemos tu plata." y los botones "Probar conexión" y "Desconectar" (en `--danger`).
- **Copia en la nube:** "Al día", "Ventas, stock y caja se guardan solos. Si se rompe el celular, no perdés nada." y "Última copia: hace X minutos" (es la última sincronización de ese equipo).
- **Acceso de soporte:** interruptor (`role="switch"`) con el texto "Prendelo solo si te lo pedimos. Se apaga solo a las 24 horas y ves todo lo que hicimos."
- **Facturación ARCA:** tarjeta con borde punteado y "Próximamente".
- Fila "Apariencia", con el tema actual y una flecha.
- Además, en "Más": usuarios, dispositivos, exportar datos (CSV) y cerrar sesión.

### 15.7 Apariencia

- Título "Apariencia" y "Elegí cómo se ve la app en este equipo. Podés cambiarlo cuando quieras."
- Grupo de radio (`role="radiogroup"`) con cuatro tarjetas. Cada una tiene una miniatura de 96×76 hecha con los colores del tema: un mosaico con su precio, un círculo del color del cartel y la barra del botón de acción.
  - **Noche:** "Oscuro. Cansa menos la vista con poca luz."
  - **Día:** "Claro. Se lee mejor con sol o mucha luz."
  - **Pizarrón:** "Verde oscuro, como la pizarra de precios."
  - **Alto contraste:** "Blanco sobre negro, para leer sin esfuerzo."
- Al elegir un tema, la pantalla entera cambia al instante.
- Nota fija: "En todos los temas, el amarillo marca precios y totales, y el rojo avisa problemas."
- El tema es **por equipo**: se guarda en `localStorage` y se aplica con `data-tema` en `<html>` antes de pintar, para que no parpadee. También se actualiza `<meta name="theme-color">`.

### 15.8 Venta sin conexión (tablet y PC)

- Banner blanco: "Sin internet. Seguí vendiendo, las ventas se suben solas cuando vuelva." con la pastilla "4 ventas esperando".
- Nota en el panel del ticket: "Sin internet no se puede generar el QR de la venta. Por ahora, cobrá en efectivo."
- Botón "Cobrar en efectivo" activo y "Cobrar con QR (necesita internet)" deshabilitado.

### 15.9 Pantallas sin mockup (seguir el mismo sistema)

- Ingreso: email y contraseña, segundo factor, invitación y PIN del cajero.
- Abrir caja.
- Alta y edición de producto.
- Cargar compra.
- Aumento masivo con vista previa.
- Gastos.
- Historial de ventas y anulación.
- Ventas pendientes de cobro.
- Usuarios y dispositivos.
- Exportar y borrar datos.
- Panel admin.

---

## 16. Sistema visual y temas

### 16.1 Reglas

- **Colores con significado, iguales en todos los temas:**
  - El amarillo es para precios y totales.
  - El verde (`--ok`) indica que algo salió bien o que hay conexión.
  - El rojo (`--danger`) avisa problemas.
  - `--action` es el botón principal (verde en Noche, Día y Alto contraste; naranja en Pizarrón).
- **Letra de marcador (Permanent Marker) solo en los montos del cartel de total.** Todo lo demás va en Bricolage Grotesque. Las partes "serias" (caja, stock, conexiones y errores) nunca usan el marcador ni elementos torcidos.
- Los mosaicos de productos son neutros (`--surface`). No usar un color por categoría.
- Los estados siempre van **en palabras**, no solo con color o ícono.

### 16.2 Tipografía

- **Bricolage Grotesque** (variable: `opsz` 12–96, `wdth` 75–100, `wght` 400–800) para toda la interfaz. Títulos en peso 800 con ancho de 80 a 82 % y un interletrado de −0,3 a −0,4 px.
- **Permanent Marker** solo para el total.
- **Fuentes servidas desde la propia app** (por ejemplo, con los paquetes `@fontsource`), no desde Google Fonts. Así funcionan sin conexión, no filtran datos a terceros y la CSP queda en `'self'`.
- Montos con `font-variant-numeric: tabular-nums` (verificar que la fuente lo soporte; si no, usar un respaldo para los números).
- Tamaños:

| Uso | Tamaño |
|---|---|
| Total en el cartel | 42 px en venta, 58 px en cobro |
| Títulos | 28 px |
| Precio en el mosaico | 22 px |
| Botón principal | 22 px |
| Texto | 15 a 17 px |
| Mínimo | 13 px, solo en las etiquetas de la barra |

- Botones de 44 px de alto como mínimo; los principales, de 56 a 64 px. Bordes redondeados de 14 a 16 px.

### 16.3 Tokens por tema

```css
:root, [data-tema="noche"] {
  --bg: #111936;          --surface: #1B2548;     --surface-2: #2C3866;
  --line: #2C3866;        --line-dashed: #3D4A80; --line-w: 1.5px;
  --text: #F4F6FB;        --text-soft: #A9B3D6;
  --nav-bg: #0C1330;      --nav-line: #2C3866;
  --ok: #2ED47A;          --danger: #FF5C6C;      --danger-dot: #E5374A;
  --scan-bg: #F4F6FB;     --scan-ink: #0B1229;
  --price-ink: #FFE94D;   --price-bg: transparent; --price-pad: 0;
  --paper: #F4F5F8;       --paper-ink: #0B1229;   --paper-soft: #5A6077;
  --paper-border: none;   --paper-line: #C5C9D6;  --paper-dot: #A9AEC0;
  --qty-bg: #0B1229;      --qty-ink: #F4F6FB;
  --star: #FFE94D;        --star-ink: #0B1229;
  --action: #2ED47A;      --action-ink: #0B1229;
  --awning-a: #2ED47A;    --awning-b: #F4F6FB;
  --stamp: #128A4A;
  --chart-1: #E3E8F7;     --chart-2: #7C8CF8;     --chart-3: #4BC3E8;
}

[data-tema="dia"] {
  --bg: #EEF1F5;          --surface: #FFFFFF;     --surface-2: #E3E8EF;
  --line: #D4DAE3;        --line-dashed: #A9B3C4; --line-w: 1.5px;
  --text: #121826;        --text-soft: #4F5B6E;
  --nav-bg: #FFFFFF;      --nav-line: #D4DAE3;
  --ok: #0A7A43;          --danger: #C8283A;      --danger-dot: #C8283A;
  --scan-bg: #121826;     --scan-ink: #FFFFFF;
  --price-ink: #121826;   --price-bg: #FFE94D;    --price-pad: 0 6px;
  --paper: #FFFFFF;       --paper-ink: #121826;   --paper-soft: #4F5B6E;
  --paper-border: 1.5px solid #D4DAE3; --paper-line: #C5C9D6; --paper-dot: #A9AEC0;
  --qty-bg: #121826;      --qty-ink: #FFFFFF;
  --star: #FFE94D;        --star-ink: #121826;
  --action: #1DB765;      --action-ink: #08130D;
  --awning-a: #1DB765;    --awning-b: #FFFFFF;
  --stamp: #0A7A43;
  --chart-1: #4F5B6E;     --chart-2: #4F5FD9;     --chart-3: #0E8FB8;
}

[data-tema="pizarron"] {
  --bg: #15302A;          --surface: #1E4038;     --surface-2: #2E5A4F;
  --line: #2E5A4F;        --line-dashed: #3F6E61; --line-w: 1.5px;
  --text: #F2F5EF;        --text-soft: #A9C4B9;
  --nav-bg: #102620;      --nav-line: #2E5A4F;
  --ok: #8BE8B5;          --danger: #FF7A7A;      --danger-dot: #FF7A7A;
  --scan-bg: #F2F5EF;     --scan-ink: #15302A;
  --price-ink: #FFE94D;   --price-bg: transparent; --price-pad: 0;
  --paper: #F4F5F1;       --paper-ink: #142420;   --paper-soft: #56645E;
  --paper-border: none;   --paper-line: #C5C9D6;  --paper-dot: #A9AEC0;
  --qty-bg: #15302A;      --qty-ink: #F2F5EF;
  --star: #FFE94D;        --star-ink: #142420;
  --action: #FF8A3D;      --action-ink: #1A0E05;
  --awning-a: #FF8A3D;    --awning-b: #F2F5EF;
  --stamp: #128A4A;
  --chart-1: #F2F5EF;     --chart-2: #9FB0FF;     --chart-3: #6FD3EE;
}

[data-tema="contraste"] {
  --bg: #000000;          --surface: #000000;     --surface-2: #1A1A1A;
  --line: #FFFFFF;        --line-dashed: #FFFFFF; --line-w: 2px;
  --text: #FFFFFF;        --text-soft: #E6E6E6;
  --nav-bg: #000000;      --nav-line: #FFFFFF;
  --ok: #3DF58B;          --danger: #FF6B6B;      --danger-dot: #FF6B6B;
  --scan-bg: #FFFFFF;     --scan-ink: #000000;
  --price-ink: #FFE94D;   --price-bg: transparent; --price-pad: 0;
  --paper: #FFFFFF;       --paper-ink: #000000;   --paper-soft: #333333;
  --paper-border: none;   --paper-line: #000000;  --paper-dot: #000000;
  --qty-bg: #000000;      --qty-ink: #FFFFFF;
  --star: #FFE94D;        --star-ink: #000000;
  --action: #3DF58B;      --action-ink: #000000;
  --awning-a: #3DF58B;    --awning-b: #FFFFFF;
  --stamp: #0A7A43;
  --chart-1: #FFFFFF;     --chart-2: #9FB0FF;     --chart-3: #6FD3EE;
}
```

- Los colores `--chart-*` de Día, Pizarrón y Alto contraste son una propuesta. En Alto contraste, además, la barra de medios de pago usa tramas o separadores.
- **Script de contraste en CI** que verifique cada par de tokens:
  - texto sobre fondo y sobre `--surface`: 4,5:1 o más;
  - total del cartel (`--star-ink` sobre `--star`): 7:1 o más;
  - bordes de controles y series del gráfico contra su fondo: 3:1 o más.
  Si un par no pasa, se ajusta el token, no se baja la regla.

---

## 17. Accesibilidad y textos

- WCAG 2.2 AA como mínimo y **AAA en el total**.
- Foco visible en todos los controles (anillo de 3 px en `--action` con separación). Orden de tabulación lógico.
- Etiquetas accesibles: el cartel es decorativo (`aria-hidden`) y el total se anuncia como texto. Los cambios de estado de cobro van en una región `aria-live="polite"`.
- Respetar `prefers-reduced-motion`.
- Las pantallas se prueban con axe en Playwright, en los tres tamaños y los cuatro temas.
- **Textos en castellano rioplatense, cortos y con voseo:** "Cobrar", "Vaciar ticket", "Cerrar caja", "Cargar compra", "Por reponer", "Sin internet", "Seguí vendiendo".
- Los errores dicen **qué pasó y qué hacer**. Por ejemplo: "No se pudo crear el QR. Revisá la conexión o cobrá en efectivo."
- Nada de jerga técnica en la interfaz (no "sincronizar"; sí "las ventas se suben solas").

---

## 18. Seguridad: reglas no negociables

Basado en el OWASP Top 10:2025. Esta lista va resumida en el `CLAUDE.md`.

1. **Aislamiento:** RLS forzada en toda tabla de negocio. El `kiosco_id` sale solo de la sesión y se fija por transacción con `set_config(..., true)`. La prueba de aislamiento entre dos kioscos corre en cada CI.
2. **Permisos en el servidor** en cada ruta, con deniego por defecto. Lista cerrada de campos aceptados por endpoint (zod `strict()`): un campo de más se rechaza.
3. **Nada de SQL armado a mano con strings.** Solo consultas parametrizadas (Kysely o `pg` con parámetros).
4. **Prohibido `dangerouslySetInnerHTML`** y cualquier inserción de HTML sin escapar.
5. **Secretos fuera del repo y fuera de los logs.** Los logs (pino) tienen redacción de tokens, cookies, contraseñas, PIN, emails y CUIT.
6. **Tokens de Mercado Pago cifrados**, con la clave fuera de la base. Nunca se mandan al cliente.
7. **Webhooks:** firma verificada **y** reconsulta a la API antes de cambiar un estado.
8. **Contraseñas con Argon2id. Segundo factor obligatorio para dueños y encargados. PIN solo en dispositivos registrados**, con límite de intentos.
9. **Cobros idempotentes:** clave por venta y por pago, y transacción única para venta, stock y pago. Ante la duda, falla cerrada.
10. **Encabezados:**
    - CSP estricta (`default-src 'self'`, sin `unsafe-inline` en scripts, `connect-src 'self'`, `img-src 'self' data: blob:`, `frame-ancestors 'none'`);
    - HSTS;
    - `X-Content-Type-Options: nosniff`;
    - `Referrer-Policy: strict-origin-when-cross-origin`;
    - `Permissions-Policy` que permita la cámara solo desde `self`.
11. **CORS** con una lista exacta de orígenes (en la práctica, el mismo origen).
12. **Límite de pedidos** en Cloudflare y en Fastify: estricto en login, PIN, invitaciones y webhooks.
13. **Auditoría** de inicios de sesión, cambios de rol, alta de dispositivos, exportaciones, anulaciones, cambios de precio masivos, conexión o desconexión de Mercado Pago y todo acceso de soporte. El dueño ve la auditoría de su kiosco.
14. **Errores genéricos** al usuario y el detalle solo en los logs, con un ID de correlación que se puede pasar a soporte.
15. **Dependencias:** lockfile, `pnpm install --frozen-lockfile`, Renovate o Dependabot, `pnpm audit` en CI, pocas dependencias e imágenes Docker fijadas por digest.
16. **Datos en el dispositivo:** en IndexedDB solo se guarda lo necesario para vender (catálogo, turno y ventas pendientes). Nada de tokens ni datos de otros kioscos. Al cerrar sesión se borra.

**Antes de abrir a clientes reales:**

- Prueba de aislamiento en verde.
- Escaneo con OWASP ZAP sobre el entorno de pruebas.
- Revisión del código contra esta lista.
- Restauración de un backup probada de punta a punta.
- MFA activo en las cuentas de Cloudflare, Hostinger, GitHub, Mercado Pago y el panel admin.

---

## 19. Informe mensual (fase 2, para dejar preparado)

- n8n corre **solo en la red interna**, sin puertos públicos, y sin acceso a Mercado Pago ni a los tokens.
- Usa el rol `mostrador_reportes`, que solo puede leer vistas del esquema `reportes`, y recorre los kioscos **de a uno** fijando `app.kiosco_id`.
- Contenido sugerido:
  - ventas del mes y comparación con el mes anterior;
  - ventas por medio de pago;
  - productos más vendidos;
  - días y horas pico;
  - productos que se quedaron sin stock más veces;
  - margen estimado, si hay costos cargados.
- Se entrega dentro de la app y, si el dueño quiere, por email.
- En la V1 solo hay que dejar las vistas bien pensadas y el rol creado.

---

## 20. Infraestructura y despliegue

- **Objetivo:** ante una falla total, perder como máximo 15 minutos de datos y volver a funcionar en menos de 4 horas.
- **Servidor:** Hostinger KVM 4 con Ubuntu LTS y actualizaciones de seguridad automáticas. SSH solo con llave, sin root y solo por Tailscale.
- **Red:** firewall que deja pasar solo el 443 desde las IP de Cloudflare. PostgreSQL, Redis y n8n no publican puertos. El panel admin se usa solo por Tailscale.
- **Despliegue:**
  - Docker Compose, con las imágenes construidas en GitHub Actions y fijadas por digest.
  - Un **entorno de pruebas** separado, con datos ficticios y Mercado Pago en modo de pruebas.
  - Migraciones antes del despliegue, siempre compatibles hacia atrás durante un ciclo.
- **Secretos:** archivos con permisos mínimos (o Docker secrets), nunca variables en el repo.
- **Backups (regla 3-2-1):**
  - archivado continuo de PostgreSQL (WAL, por ejemplo con pgBackRest o WAL-G) más una copia completa diaria;
  - cifrados, en almacenamiento de otro proveedor;
  - se conservan 30 días;
  - **se prueba una restauración por mes**, con un script en `infra/backup/`.
- **Monitoreo:**
  - chequeo de disponibilidad cada minuto, con alerta al celular;
  - seguimiento de errores de la app y la API (Sentry o GlitchTip autoalojado), sin datos personales;
  - alertas por picos de 401 y 403, por fallas de webhooks y por tokens de Mercado Pago a punto de vencer.
- **Endpoint `/health`**, interno, para chequear la base, Redis y la cola.

---

## 21. Pruebas

| Tipo | Qué cubre |
|---|---|
| Unidad (Vitest) | Dinero y redondeos, vuelto, cálculo del cierre de caja, parser de códigos de balanza, detector de ráfagas del lector, aumento masivo |
| Integración (Vitest + PostgreSQL real) | RLS y aislamiento entre kioscos, transacción de venta, idempotencia de `sync` y de pagos, roles de base |
| API | Permisos por rol en cada ruta, rechazo de campos de más, límites por plan |
| Mercado Pago | Firma de webhooks (válida, inválida, vieja), reconsulta, órdenes vencidas y canceladas, dos cuentas de vendedor |
| Punta a punta (Playwright) | Venta completa en efectivo y con QR simulado, cierre de caja, stock por reponer, aumento masivo, cambio de tema |
| Sin conexión (Playwright `setOffline`) | Vender sin red, recargar con ventas pendientes, volver la red, lote duplicado |
| Tamaños | 390×844, 1024×768 y 1366×768, en los cuatro temas, sin scroll horizontal y con Vender sin scroll vertical |
| Teclado | Venta completa en PC sin mouse, con los atajos |
| Accesibilidad | axe en cada pantalla y script de contraste de tokens |

---

## 22. Plan de trabajo por etapas

Cada etapa termina con su "Listo cuando". Si no se cumple, no se pasa a la siguiente.

**Etapa A: Base**

- Monorepo, CI, Compose de desarrollo, migraciones, roles de base, RLS, `withKiosco` y semillas de dos kioscos.
- Paquete `ui` con tokens de los cuatro temas, tipografías propias y layout responsive con barra inferior o lateral.
- **Listo cuando:** la prueba de aislamiento corre en CI y está en verde, y una pantalla vacía cambia entre los cuatro temas y los tres tamaños.

**Etapa B: Cuentas y acceso**

- Panel admin mínimo (alta de kiosco e invitación), invitación del dueño, contraseña con segundo factor (passkey y TOTP), sesiones, roles, registro de dispositivos y PIN de cajero.
- **Listo cuando:** un cajero con PIN entra en un equipo registrado y no puede en otro, y todas las rutas niegan por defecto.

**Etapa C: Catálogo y stock**

- Productos, códigos, categorías, búsqueda, cargar compra, ajustes, Por reponer y aumento masivo con vista previa y deshacer.
- **Listo cuando:** se cargan 200 productos por CSV de prueba, se busca por nombre y código en menos de 100 ms en el equipo, y el aumento masivo se puede deshacer.

**Etapa D: Venta y caja con conexión**

- Vender, Cobrar (efectivo con vuelto y transferencia), Cobrado, abrir y cerrar caja, gastos, anulación y Apariencia.
- **Listo cuando:** el flujo completo funciona en celular, tablet y PC, y en PC se puede hacer sin mouse.

**Etapa E: Sin conexión**

- Service worker, Dexie, bandeja de salida, `sync` idempotente, banner y avisos de stock negativo.
- **Listo cuando:** pasan todas las pruebas de la sección 12 y no se pierde ni se duplica ninguna venta.

**Etapa F: Mercado Pago**

- OAuth con PKCE, cifrado de tokens, sucursal y caja, órdenes QR, webhooks con firma, reconsulta, pendientes de cobro y renovación de tokens.
- **Listo cuando:** en el entorno de pruebas, con dos vendedores, todos los casos de la sección 13.5 pasan, y un webhook falso no cambia nada.

**Etapa G: Periféricos**

- Lector USB (detector de ráfagas), escaneo con cámara, códigos de balanza e impresión de 58 y 80 mm.
- **Listo cuando:** está probado en un celular Android real, en una PC con Windows, un lector USB y una impresora térmica.

**Etapa H: Producción**

- Hostinger, Cloudflare, Caddy, firewall, Tailscale, backups con restauración probada, monitoreo, ZAP, revisión de seguridad, CSV para el contador y exportar o borrar la cuenta.
- **Listo cuando:** se cumple toda la lista "Antes de abrir a clientes reales" de la sección 18.

**Después del MVP:** 5 kioscos piloto durante 2 semanas sin perder ventas. Recién ahí se encara la fase 2 (proveedores, fiado, informe mensual, guías y devoluciones por API).

**Etapa I: Rubros** (agregada en octubre de 2026, ver `docs/decisiones/009-rubros.md`)

Por lo que se vio en la calle, antes de los pilotos se adelanta el soporte para ferreterías, perfumerías y almacenes. Cada rubro tiene su diseño y sus funciones; la base es la misma.

- **I1. Rubro y alta:** rubro y funciones por comercio, rubro en el alta del panel, el dueño confirma el rubro y elige categorías y funciones al entrar, estilo sobrio con tres temas nuevos.
  **Listo cuando:** un dueño de ferretería entra por el enlace, confirma el rubro y la app queda sin toldo ni estrella, con sus categorías; los siete temas pasan contraste y axe en los cuatro tamaños.
- **I2. Mostrador de ferretería:** unidad por producto (unidad, metro, kilo, litro, caja), cantidades con decimales, ubicación, lista de gremio, búsqueda que entiende medidas (2,5 = 2.5 = 2½) y pantalla Vender con tabla en PC.
  **Listo cuando:** en PC se vende 12,5 m de cable con la lista de gremio sin mouse, el stock baja 12,5 y el ticket lo muestra bien.
- **I3. Proveedores y precios:** proveedores, código del proveedor por producto, importar su lista (CSV o Excel), cruce por código, vista previa manteniendo la ganancia y redondeo, aplicar con auditoría y deshacer, etiquetas nuevas.
  **Listo cuando:** una lista de 1.000 renglones se cruza, se revisa y se aplica en menos de un minuto, y se puede deshacer.
- **I4. Presupuestos y remitos:** guardar el ticket como presupuesto, mandarlo por WhatsApp, imprimirlo, pasarlo a venta con los precios del día o los del presupuesto, y remito sin precios.
  **Listo cuando:** un presupuesto se crea, se manda, vence y se convierte en venta sin cargar nada de nuevo.
- **I5. Clientes y cuenta corriente (fiado):** clientes con lo mínimo, cobrar a cuenta con límite, pagos a cuenta, saldo y movimientos, exportación y borrado.
  **Listo cuando:** una venta a cuenta suma al saldo en la misma transacción que la venta, un pago lo baja, el límite se respeta y los datos del cliente salen en la exportación y se borran con la cuenta.
- **I6. Tablero:** lo que más y menos se vende, lo que no se mueve, por reponer, ganancia por categoría, deuda de clientes y precios desactualizados.
  **Listo cuando:** con 10.000 ventas de prueba el tablero carga en menos de 2 segundos.
- **I7. Perfumería:** variantes (tono, tamaño) con stock propio, promos automáticas, regalo y ticket de cambio, cambios, y vencimientos por lote.
  **Listo cuando:** una venta con 3 esmaltes de tonos distintos aplica el 3x2, baja el stock de cada tono y el ticket de cambio sale sin precios.

---

## 23. No hacer

- No guardar contraseñas, claves fiscales ni datos de tarjeta de los comercios ni de sus clientes.
- No pedir a Mercado Pago más permisos que los necesarios para crear órdenes QR y consultarlas.
- No hacer cobros ni devoluciones automáticas sin una acción del usuario.
- No usar Permanent Marker ni elementos torcidos fuera del cartel del total (y nunca en el estilo sobrio).
- No cargar fuentes, scripts ni imágenes de terceros en la app (salvo lo que exija Mercado Pago, que hoy no es nada en el cliente).
- No mostrar datos de un kiosco al soporte sin el permiso activo del dueño.
- No crear tablas de consentimientos ni comprobantes fiscales en la V1. (Clientes de cuenta corriente: adelantados en la etapa I5 con OK del dueño del proyecto, decisión 009.)
- No recargar la app sola con un ticket abierto.
- No usar números autoincrementales visibles como ID en URLs.

---

## 24. Decisiones pendientes (las toma el dueño del proyecto)

- Nombre comercial y dominio.
- Cómo se cobra el abono a los kioscos (manual, débito con Mercado Pago o transferencia). En la V1 el admin marca el estado a mano.
- Passkey como segundo factor principal (más fácil para el kiosquero) o solo TOTP.
- Si cada equipo tiene su propia caja o todos comparten el turno (la V1 asume un turno compartido).
- Herramienta de seguimiento de errores y proveedor de almacenamiento para backups.
- Modelos de lector e impresora térmica para recomendar a los kioscos.
- Términos, privacidad y acuerdo de tratamiento de datos, con un abogado, antes de lanzar.
- Precios y planes, validados con 15 kioscos reales.

---

## 25. Referencias

- OWASP Top 10:2025: https://owasp.org/Top10/
- Mercado Pago: OAuth, cómo obtener el token: https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation
- Mercado Pago: introducción a OAuth: https://www.mercadopago.com/developers/en/docs/security/oauth/introduction
- Mercado Pago: QR con la API de Orders (migración y referencia): https://www.mercadopago.com.ar/developers/es/docs/qr-code/resources/migrate-dynamic-qr-model-to-orders
- Mercado Pago: webhooks y validación de la firma: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
- PostgreSQL: Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Workbox: https://developer.chrome.com/docs/workbox
- Dexie: https://dexie.org
- MDN: Barcode Detection API: https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API
- SimpleWebAuthn (passkeys): https://simplewebauthn.dev
