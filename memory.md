# Memoria del proyecto Mostrador (para retomar en otra sesión)

Pegá este archivo al inicio de la sesión nueva, o pedile a Claude que lo lea. No tiene
contraseñas ni claves: esas no se pasan por chat.

## Cómo trabajar con la persona

- Responder siempre en castellano rioplatense, con voseo y sin jerga técnica. Respuestas cortas.
- No gastar tokens de más: la persona pidió ir de a poco.
- La persona va ejecutando los comandos en su servidor y yo la guío. Nunca pedir ni pegar
  contraseñas, secretos TOTP, `claves.json` ni credenciales en el chat. Para cargarlas se usa
  `read -rs` en el servidor.
- Reglas de `CLAUDE.md` del repo: preguntar antes de agregar una dependencia grande, cambiar el
  modelo de datos de forma incompatible, tocar políticas RLS o roles de base, o guardar un dato
  personal nuevo.
- No crear Pull Request salvo que se pida. La persona pidió que **todo vaya a la rama principal
  `claude/mostrador-etapa-a-7jft9w`** del repo `facudom03/kioscos` (es la rama por defecto y la
  que usa el servidor). Si la sesión indica otra rama de trabajo, subir ahí y además a la
  principal.
- Los commits terminan con las líneas de atribución que indique el sistema. No poner nombres de
  modelo en el repo.
- Verificar siempre el código de salida de lint, format, typecheck y tests (no esconderlo con
  `| head`).
- **Siempre que se suba algo, mandarle el comando para actualizar el servidor** (la persona lo
  pidió explícitamente):
  ```sh
  cd /opt/mostrador/app && git pull
  cd infra && docker compose -f compose.prod.yml -f compose.traefik.yml \
    --env-file /opt/mostrador/config.env up -d --build
  ```
  y recordarle tocar "Actualizar" en la app.

## Qué es

Mostrador: sistema de gestión en la nube para kioscos y otros comercios (ferretería, perfumería,
almacén, librería). PWA que anda sin conexión. Especificación en `docs/SPEC.md`, decisiones en
`docs/decisiones/`, guía de producción en `docs/DEPLOY.md`.

Monorepo pnpm, Node 22 corriendo TypeScript directo (imports con extensión `.ts`/`.tsx`, nada de
`enum`). `apps/web` (React + Vite + Workbox + Dexie), `apps/api` (Fastify), `apps/worker`
(BullMQ, Mercado Pago), `apps/admin` (panel interno), `packages/shared`, `db`, `ui`, `servidor`,
`mp`. PostgreSQL 16 con RLS forzada, Redis.

Comandos útiles: `pnpm lint && pnpm format:check && pnpm typecheck`, `pnpm test` (necesita
`TEST_DATABASE_ADMIN_URL` y PostgreSQL), `pnpm contraste`, `pnpm e2e` (Playwright, 4 tamaños).

## Estado

- Etapas A a H hechas. Etapa I (rubros) hecha: I1 rubro y diseño por rubro, I2 ferretería,
  I3 proveedores y listas de precios, I4 presupuestos y remitos, I5 clientes y cuenta
  corriente, I6 tablero, I7 perfumería (variantes, promos, regalo, vencimientos).
- Revisión de seguridad y correctitud de la etapa I hecha y corregida.
- Escáner con guía hecho (ver abajo). Todo está subido y las pruebas pasan (unidad, integración
  y e2e).

### Lo último que se hizo

- **Historial** (`/historial`, Más → Gestión; dueño y encargado): pestañas Ventas, Compras,
  Caja y Stock, período Hoy / 7 / 30 días, y el detalle de cada uno al tocarlo (venta con
  productos, pagos y "Anular"; compra con productos y costos; cierre de caja con ventas por
  medio, gastos, retiros, contado y diferencia, y "Ver las ventas de este turno"). En Caja, las
  ventas del turno y los cierres anteriores se abren al tocarlos. Accesos: Stock → Movimientos,
  Cargar compra → Ver compras anteriores, ficha de producto → Ver todos los movimientos.
  API nueva: `GET /api/v1/caja/cierres/:id`, `GET /api/v1/compras/:id` (y `desde`/`hasta` en la
  lista), `GET /api/v1/movimientos-stock` (`routes/movimientos.ts`), todas en
  `casos-aislamiento.ts`.

- **Descargar mi stock (Excel)** en Stock y en Importar: `GET /api/v1/exportar/productos.xlsx`
  (dueño, encargado, soporte; auditado como `exportacion.xlsx`; costo solo si lo puede ver),
  con las mismas columnas que la planilla modelo (`planillaDeStock` en `importar.ts`). Al
  volver a subirla actualiza: la importación ahora también reconoce por nombre los productos
  sin código (si hay uno solo con ese nombre), así no se duplican. El stock de productos
  existentes no cambia al importar.

- **Atajos de gestión:** la lista nueva de un proveedor recuerda las columnas y los números
  (bonificación, IVA, ganancia, redondeo, gremio) de su última lista (van en `opciones.columnas`
  de `listas_proveedor`, sin migración); la ficha de producto tiene Escanear para el código; al
  cargar un producto desde un código desconocido en Vender se vuelve a la venta con el producto
  sumado (`?volver=vender`); Por reponer tiene "Mandar la lista por WhatsApp". Ideas no hechas:
  listas en PDF y Excel viejo (.xls), recibir listas por mail, ver precio de costo y margen al
  escanear en Stock.

- **Escanear en Stock y en Cargar compra** (idea de la persona): en Stock, el botón Escanear (o
  un código tipeado o del lector USB en el buscador) muestra solo ese producto con precio y
  stock; si el código no existe ofrece "Cargar producto". En Cargar compra, el escáner suma a
  la compra cada producto leído sin cerrar la cámara. `Escaner` tiene la prop `ayuda` para el
  texto de abajo de la cámara.

- **Revisión UX/UI** contra Square, Loyverse, Mercado Pago y sistemas argentinos (YoFacturo,
  MiPOS): nuestro diferencial es el estilo kiosco (toldo, cartel con marcador, precios
  amarillos) y el sobrio para ferreterías. Mejoras: ingreso con la marca "Mostrador" grande y
  centrado en tablet/PC (sin la etiqueta en mayúsculas); Cobrar en columna centrada y un medio
  de pago por renglón en celular, QR sin conectar se ve deshabilitado; Caja no se estira a todo
  el ancho; Stock con las herramientas (Aumentar precios, Proveedores, Tonos y tamaños, Ver
  vencimientos) como una fila de botones en vez de tarjetas, y la barra de nivel solo si hay
  mínimo cargado. Ideas no hechas: teclado numérico para cobrar un monto suelto, colores o
  fotos por producto en los mosaicos.

- **Vender en el celular** (menos de 600 px): encabezado en dos renglones, ticket plegado
  abajo ("Ticket · N productos", "Último: …", Ver/Ocultar) con total y Cobrar siempre a la
  vista; desplegado muestra renglones con − y +, "Vaciar ticket" y "Guardar presupuesto".
  Hook `useEsCelular` en `apps/web/src/nucleo/medios.ts`. Tablet y PC casi sin cambios.

- **Escáner con guía** (`apps/web/src/componentes/Escaner.tsx`): marco con línea roja, aviso
  "Mantené unos 15 cm de distancia", lee solo dentro del marco (cuentas en
  `packages/shared/src/camara.ts`), pide 1920×1080 y enfoque continuo, muestra la imagen al
  doble si la cámara da 900 px o más de lado corto (para que a 15 cm el código llene el marco),
  tocar para enfocar y linterna donde el navegador lo permite, pitido y "Último código leído".
  Prueba e2e `apps/web/e2e/camara.spec.ts` con cámara falsa de Chromium (video y4m con un
  EAN-13). **Falta probarlo con un iPhone real**; si sigue costando, el paso siguiente es pedir
  zoom por hardware (`zoom` en `applyConstraints`) donde exista.
- Pruebas de presupuestos vencidos (API y e2e): fallaban entre las 0 y las 3 (UTC) porque usaban la fecha de la
  base en vez de la de Argentina. Corregidas.

- **Tablero**: cuando no hay datos muestra "Primeros pasos" en vez de cuadros vacíos. Ahora tiene
  sección propia en la barra de navegación (dueño y encargado; el cajero no la ve).
- **Más**: reorganizado en grupos (Gestión, Personas y seguridad, Este equipo), con tarjetas en
  2 o 3 columnas.
- **Importar productos**: botón "Descargar planilla (Excel)" que genera un `.xlsx` modelo según el
  rubro y las funciones activas (unidades, ubicación, precio gremio), con ejemplos y una hoja
  "Cómo llenarla". Se puede subir el `.xlsx` o un CSV. Código en
  `packages/shared/src/importar.ts` y `xlsx-escribir.ts` (escritor propio sin dependencias).
- **Botón "Actualizar"** de la PWA: ahora recarga siempre al aplicar la versión nueva
  (`apps/web/src/nucleo/actualizacion.ts`).

## Producción (servidor del cliente, Hostinger)

- App en `https://mimostrador.tech` (antes `mostrador.srv1995859.hstgr.cloud`, que ya no
  anda), detrás de un Traefik que ya existía. DNS en Hostinger: A `@` → `2.25.133.5` y AAAA
  `@` → `2a02:4780:75:b0ce::1` (las IP del VPS). `DOMINIO=mimostrador.tech` en `config.env`.
  Se levanta con `infra/compose.prod.yml` más `infra/compose.traefik.yml`.
- Código en `/opt/mostrador/app`, configuración en `/opt/mostrador/config.env`, secretos en
  `/opt/mostrador/secretos`.
- Actualizar el servidor:
  ```sh
  cd /opt/mostrador/app && git pull
  cd infra && docker compose -f compose.prod.yml -f compose.traefik.yml \
    --env-file /opt/mostrador/config.env up -d --build
  ```
  Después, en la app, tocar "Actualizar" en el cartel (o cerrar todas las pestañas y reabrir).
- El panel admin solo escucha en `127.0.0.1:8081`: se entra con un túnel SSH
  (`ssh -L 8081:127.0.0.1:8081 root@<servidor>`). El usuario del panel es distinto del de los
  comercios.
- Si el panel bloquea la cuenta por intentos: poner `intentos_fallidos=0` y `bloqueado_hasta=null`
  en la tabla `admins`.

### Pendientes de producción (avisados a la persona)

- No hay "olvidé mi contraseña". Se ofreció armar un enlace de contraseña nueva desde el panel
  admin; sin respuesta todavía.
- Respaldos sin configurar (paso 7 de `docs/DEPLOY.md`). Decisión de la persona: con el primer
  cliente contrata el respaldo diario de Hostinger; el respaldo propio a otro proveedor
  (Backblaze B2 recomendado) queda para después. Los WAL se acumulaban (1,5 GB): se le pasó un
  cron de root que borra los de más de 2 días.
- Cloudflare: no se usa. La variante Traefik de `docs/DEPLOY.md` no lo necesita y el DNS de
  `mimostrador.tech` está en Hostinger.
- Se ofreció que la dirección vieja redirija a la nueva; sin respuesta.
- El escáner con guía y Vender en el celular ya están en la rama principal. Falta que la persona
  actualice el servidor y lo pruebe (iPhone para el escáner).
- Firewall de hPanel activo: acepta TCP 22, 80, 443, 8000 (Control Domínguez), 32768 (Hermes) y
  32770 (n8n) y descarta todo lo demás. El PostgreSQL de otra app (32769) ya quedó cerrado.
  Pendiente: n8n se usa por `http://2.25.133.5:32770` sin cifrar; se le pasaron los pasos para
  `https://n8n.mimostrador.tech` (DNS A/AAAA `n8n` + labels de Traefik con certresolver
  `letsencrypt`) y después borrar la regla del 32770. Lo mismo con 8000 y 32768.
- SSH: desde internet solo con clave (la persona tiene una clave ed25519 en su Windows; el panel
  se abre con `ssh -L 8081:127.0.0.1:8081 root@2.25.133.5` en PowerShell y
  `http://127.0.0.1:8081`). La contraseña sigue valiendo solo desde `169.254.0.0/16`, que es la
  terminal de hPanel que usa la persona (`Match Address` al final de `/etc/ssh/sshd_config` y
  `/etc/ssh/sshd_config.d/00-sin-contrasena.conf`; respaldo en `/root/sshd_config.respaldo`).
- Servidor: Ubuntu 24.04 con 10 actualizaciones pendientes y "System restart required". Falta
  actualizar y reiniciar en un horario sin ventas. No pasar a 26.04 por ahora.
- Mercado Pago: aún sin configurar. Falta crear la aplicación en Mercado Pago, dos vendedores y un
  comprador de prueba, cargar Client ID, secreto y clave de webhooks (con `read -rs`), usar
  `MP_PRUEBAS=1` y probar. Pasos en `docs/DEPLOY.md`, sección 6.

## Ideas y pendientes de producto

- **Nombre**: se evaluó renombrar el producto (hoy "Mostrador"). Opciones: Caja Abierta, Despacho.
  Sin decisión. Antes verificar INPI, dominio e Instagram.
- **"Gremio"**: es el precio especial para clientes que compran por oficio (plomero, electricista).
  Se pensó renombrarlo a "Profesional" o "Precio especial" en la interfaz, pero sin decisión.
  Mantener aceptada la columna "Precio gremio" en las planillas.
- No existe integración con Mercado Libre (solo Mercado Pago para QR).
- Fuera de lo hecho: devolución de pagos QR por API, y corregir la dirección de la sucursal de
  Mercado Pago (se crea genérica en Buenos Aires).

## Cómo funciona Mercado Pago en producción

Una sola aplicación de Mercado Pago (la de Mostrador). Cada dueño la autoriza con su propia cuenta
en Más → Conexiones y la plata le entra directo a él. Los tokens van cifrados. Antes de dar un
cobro por pagado se reconsulta a la API y se verifica venta, monto y cuenta. Detalle en
`docs/decisiones/007-mercado-pago.md`.

## Cómo seguir

1. Leer `CLAUDE.md`, `docs/SPEC.md` y este archivo.
2. Confirmar con la persona qué sigue: hay que elegir entre el enlace de contraseña nueva, los
   respaldos, el endurecimiento del servidor, probar Mercado Pago, el nombre de la app, o ajustar
   el escáner después de probarlo con un iPhone.
3. Trabajar en la rama que indique la sesión.
