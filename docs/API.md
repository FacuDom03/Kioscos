# API para los comercios y avisos automáticos

Cada comercio puede conectar su negocio con n8n, Make, Zapier o un sistema propio. Hay dos
partes:

- **Claves de acceso:** la herramienta **lee** datos del negocio cuando quiere.
- **Avisos automáticos (webhooks):** Mostrador le **avisa** a la herramienta en el momento en que
  pasa algo.

Las dos se manejan en Más → API y automatizaciones, y solo las ve el dueño.

## Seguridad: lo que se decidió

| Riesgo                                    | Cómo se cubre                                                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Que una clave robada cambie algo          | La API es **solo de lectura**. No hay ninguna ruta que escriba                                                                                                          |
| Que una clave lea datos de otro comercio  | El comercio sale de la clave, nunca del pedido. Todo pasa por `withKiosco` y RLS, y las rutas están en la prueba de aislamiento                                         |
| Que se filtre la clave guardada           | En la base solo está su hash (SHA-256 de 32 bytes al azar). La API ni siquiera tiene permiso para leer esa columna: la reconoce `auth_clave_api`                        |
| Clave olvidada o de alguien que se fue    | Se revoca en un clic y corta en el momento. Si quien la creó deja de ser dueño, la clave deja de andar sola                                                             |
| Datos personales (clientes)               | Solo con el permiso "clientes", que se elige al crear la clave. Cada lectura queda en la actividad (`api.clientes`)                                                     |
| Abuso o un script en bucle                | 120 pedidos por minuto por clave, además del límite por IP de toda la API                                                                                               |
| Usar la sesión de la app desde otro sitio | Las rutas de la API no leen la cookie, y la clave no sirve para las rutas de la app. No hay CORS: no se puede usar desde una página web                                 |
| Que un aviso llegue a la red interna      | Solo `https`, nada de usuario y contraseña en la dirección. Se revisa la IP a la que de verdad se conecta (también si el nombre cambia de IP), sin seguir redirecciones |
| Avisos falsos a la herramienta            | Cada aviso va firmado con un secreto propio de ese webhook, guardado cifrado con la clave maestra                                                                       |
| Que un webhook caído trabe algo           | Los avisos salen después de guardar la venta y desde el worker, con reintentos. Tras 50 errores seguidos el aviso se pausa y el dueño lo ve                             |
| Auditoría                                 | Crear y revocar claves, agregar, pausar y quitar avisos, y leer clientes quedan en Más → Actividad                                                                      |

Límites: hasta 10 claves activas y 5 avisos por comercio.

## Usar la API

Todas las rutas son `GET` y empiezan con `https://mimostrador.tech/api/externa/v1`. La clave va en
el encabezado:

```
Authorization: Bearer mst_…
```

- **Importes:** en centavos, como números enteros. `150000` son $ 1.500.
- **Fechas:** ISO 8601. Los días (`desde`, `hasta`, `dia`) van como `AAAA-MM-DD` y se cuentan en la
  hora de la Argentina.
- **Listas:** traen hasta 100 elementos (`limite`, de 1 a 500). Si hay más, `siguiente` trae un ID:
  se pide la página siguiente con `despues=<ese ID>`. Cuando `siguiente` es `null`, no hay más.
- **Parámetros:** un parámetro que no existe se rechaza con 400.

| Ruta                       | Qué devuelve                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/negocio`                 | Nombre, rubro y permisos de la clave. Sirve para probar la conexión                                   |
| `/resumen?dia=`            | Ventas cobradas del día, total, ticket promedio, total por medio de pago y anuladas. Sin `dia`: hoy   |
| `/ventas?desde=&hasta=`    | Ventas del período (sin fechas: los últimos 7 días; como mucho un año): fecha, estado, total y medios |
| `/ventas/:id`              | Una venta con sus productos y pagos                                                                   |
| `/productos?porReponer=si` | Productos activos: precio, costo, precio de gremio, categoría, stock, mínimo, unidad y códigos        |
| `/productos/:id`           | Un producto (aunque esté archivado)                                                                   |
| `/compras?desde=&hasta=`   | Compras del período: fecha, total, nota y cantidad de productos                                       |
| `/clientes`                | Clientes de cuenta corriente: nombre, teléfono, límite y saldo. **Solo con permiso "clientes"**       |

Errores: el mismo formato que la app: `{ "error": "…", "codigo": "…", "id": "…" }`.

- `401 clave_invalida`: la clave no existe, se revocó o quien la creó ya no es dueño.
- `403 sin_permiso`: a la clave le falta el permiso de clientes.
- `429 demasiados_pedidos`: se pasó el límite.

## Avisos automáticos

Mostrador manda un `POST` con JSON a la dirección que cargó el dueño:

```json
{
  "id": "0192…",
  "evento": "venta.creada",
  "creado": "2026-10-18T22:15:03.120Z",
  "datos": {
    "id": "0192…",
    "fecha": "…",
    "estado": "cobrada",
    "total": 300000,
    "items": [],
    "pagos": []
  }
}
```

| Evento          | Cuándo                                                                                 | `datos`                                            |
| --------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `venta.creada`  | Se guarda una venta cobrada (también las hechas sin internet, al subirse)              | La venta, igual que `/ventas/:id`                  |
| `venta.anulada` | Se anula una venta                                                                     | La venta, con `anuladaEn` y `motivoAnulacion`      |
| `compra.creada` | Se carga una compra                                                                    | `id`, `fecha`, `total`, `nota` e `items` con costo |
| `stock.bajo`    | Un producto llega a su stock mínimo o menos con una venta (avisa una vez, al cruzarlo) | `productos`: `id`, `nombre`, `stock`, `minimo`     |
| `prueba`        | El dueño toca "Probar"                                                                 | `mensaje`                                          |

Las ventas cobradas con QR de Mercado Pago todavía no generan `venta.creada`. Se suma cuando se
active Mercado Pago (queda pendiente en `packages/mp`).

**Cabeceras:**

- `x-mostrador-evento`: el evento.
- `x-mostrador-id`: el mismo `id` del cuerpo. Si llega dos veces (por un reintento), descartar
  el repetido.
- `x-mostrador-firma`: `t=<segundos>,v1=<firma>`.

**Verificar la firma:** calcular el HMAC-SHA256 en hexadecimal, con el secreto `whsec_…`, de
`"<t>.<cuerpo tal cual llegó>"`, y compararlo con `v1`. Descartar si `t` tiene más de 5 minutos.
En n8n, con un nodo Code:

```js
const crypto = require('crypto');
const [t, v1] = $json.headers['x-mostrador-firma'].split(',').map((p) => p.split('=')[1]);
const esperada = crypto
  .createHmac('sha256', 'whsec_…')
  .update(`${t}.${JSON.stringify($json.body)}`)
  .digest('hex');
if (esperada !== v1 || Date.now() / 1000 - Number(t) > 300) throw new Error('Firma inválida');
```

(Si la herramienta vuelve a armar el JSON, la firma puede no coincidir. Conviene leer el cuerpo
crudo: en n8n, la opción "Raw Body" del nodo Webhook.)

**Respuesta esperada:** cualquier 2xx en menos de 8 segundos. Si no llega, el worker reintenta a
los 30 segundos y a los 1, 2, 4 y 8 minutos. No se siguen redirecciones.

## Cómo está hecho

- **Base:** migración `0014_api.sql`.
  - Tablas `claves_api` y `webhooks`, con RLS forzada y FK compuestas.
  - Función de sistema `auth_clave_api`.
  - `kiosco_borrar_datos` borra las dos tablas.
- **API:**
  - `apps/api/src/sesion.ts`: las rutas con `config.externa` solo entran con clave (deniego por
    defecto, en el mismo lugar que las sesiones).
  - `routes/externa.ts`: lectura.
  - `routes/api-negocio.ts`: manejo de claves y avisos.
  - `servicios/avisos.ts`: qué lleva cada evento.
  - `app.avisar`: encola después de confirmar la transacción.
- **Envío:**
  - `packages/servidor/src/avisos.ts`: direcciones permitidas, firma y envío HTTPS con la IP
    revisada.
  - `packages/servidor/src/entregas.ts`: busca destinos, entrega y anota el resultado.
  - `apps/worker`: cola `avisos`, una entrega por webhook, con reintentos.
- **Pantalla:** `apps/web/src/pantallas/mas/ApiNegocio.tsx`.
- **Pruebas:**
  - `apps/api/test/api-negocio.test.ts` y los casos de `casos-aislamiento.ts`;
  - `packages/servidor/test/avisos.test.ts`, con un servidor HTTPS local;
  - `apps/web/e2e/api.spec.ts`, en los cuatro tamaños y con axe.

## Para más adelante

- Escritura con permisos aparte (por ejemplo, actualizar precios desde una planilla), auditada y
  con la misma vista previa que el aumento masivo.
- `venta.creada` para los cobros con QR al confirmarse el pago.
- Historial de envíos de cada aviso en la pantalla.
