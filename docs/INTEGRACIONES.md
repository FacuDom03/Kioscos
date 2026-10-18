# Plan de integraciones

Estado: **plan** (octubre de 2026). Ordena qué conectar con Mostrador, en qué orden y qué hace
falta para cada una. Lo marcado como "verificar" se confirma con la documentación vigente antes
de programar. Las integraciones que guardan datos nuevos o tocan el modelo de datos se consultan
antes de empezar (regla de `CLAUDE.md`).

## Cómo se decidió el orden

Para cada integración se miró:

- **Trámites:** si hace falta que otra empresa nos apruebe (revisión de app, ser socio,
  verificación de empresa) o si alcanza con crear una cuenta o una app gratis.
- **Valor para el comercio:** cuánto le ahorra o le hace vender.
- **Esfuerzo y riesgo:** cuánto código y qué datos sensibles mueve.

## Resumen

| #   | Integración                                         | Trámites para empezar                                                            | Esfuerzo     | Para qué                                                                              |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| 1   | Email (avisos y "olvidé mi contraseña")             | Ninguno: cuenta en un proveedor y verificar el dominio                           | Bajo         | Recuperar la cuenta sin depender de nosotros; resumen diario                          |
| 2   | Avisos a otras apps (webhooks salientes) y API      | Ninguno                                                                          | **Hecho**    | Conectar con n8n, Make, Zapier, LeadConnector, Google Sheets (ver `docs/API.md`)      |
| 3   | Entrada de contactos y pedidos (webhook entrante)   | Ninguno                                                                          | Bajo         | Recibir leads de Facebook vía LeadConnector/Zapier/Make sin pasar la revisión de Meta |
| 4   | Análisis con IA (Claude)                            | Ninguno: cuenta de API de Anthropic                                              | Bajo a medio | Informe semanal y preguntas en palabras ("¿qué conviene reponer?")                    |
| 5   | Mercado Pago: cobrar la suscripción a los comercios | Ninguno extra (la app de MP ya existe)                                           | Medio        | Que Mostrador cobre su abono todos los meses, solo                                    |
| 6   | Mercado Libre: stock y ventas                       | App gratis + validar datos del titular; sin certificación para operar            | Medio a alto | Que una venta en ML descuente stock en Mostrador y al revés                           |
| 7   | Tiendanube: stock, precios y pedidos                | Registro gratis como socio; app privada sin homologación (solo tiendas elegidas) | Medio        | Tienda online y local con el mismo stock                                              |
| 8   | Mercado Pago Point (posnet)                         | Verificar si alcanza con la app actual                                           | Medio        | Cobrar con tarjeta desde Vender                                                       |
| 9   | Facturación ARCA                                    | Sin ser socio de ARCA, pero: CUIT propio, proveedor (Afip SDK), términos legales | Alto         | Factura electrónica desde la venta (ver decisión 010)                                 |
| 10  | WhatsApp Business (envío automático)                | Verificación de empresa en Meta, número dedicado, plantillas aprobadas           | Medio        | Mandar ticket o recordatorio de deuda solo                                            |
| 11  | Facebook Lead Ads directo (API de Meta)             | Revisión de la app (`leads_retrieval`) y verificación de empresa                 | Medio        | Lo mismo que la 3, sin intermediario. **No conviene al principio**                    |

Ya funcionan hoy: Mercado Pago QR (cobro), enlaces de WhatsApp (presupuestos, cuentas,
invitaciones), exportar CSV para el contador y Excel de stock.

## Base común (se hace una vez, sirve para todas)

Antes de la primera integración nueva:

1. **Pantalla Conexiones** (ya existe en Más): cada integración con su estado en palabras
   ("Conectado", "Sin conectar", "Con error: …"), cómo conectarla y cómo desconectarla.
2. **Secretos cifrados** con la clave maestra fuera de la base, como los tokens de Mercado Pago
   (regla 6). Nunca viajan al navegador ni aparecen en los logs.
3. **Firma y reconsulta** (regla 7): todo lo que llega de afuera se verifica con firma HMAC y, si
   cambia un estado (un pedido pagado, una venta), se reconsulta a la API de origen.
4. **Trabajos en segundo plano** con el worker (BullMQ) que ya usa Mercado Pago: reintentos, cola
   por comercio y nada que frene una venta.
5. **Auditoría** de conectar, desconectar y de cada sincronización (regla 13).
6. **Aislamiento:** toda ruta nueva entra en `apps/api/test/casos-aislamiento.ts` (regla 1). Un
   pedido de Tiendanube del comercio A nunca toca el stock del B.
7. **Límites:** límite de pedidos en los webhooks entrantes (regla 12) y topes de uso por comercio
   donde haya costo (IA, emails).

## Detalle por integración

### 1. Email transaccional

- **Qué resuelve:** hoy no hay "olvidé mi contraseña". Si un dueño se olvida, depende de nosotros.
  Con email: enlace para elegir una contraseña nueva (vence en 1 hora, de un solo uso y con el
  segundo factor igual pedido al entrar). También sirve para el resumen del día y avisos de stock
  bajo.
- **Cómo:** proveedor con API (Resend, Brevo o Amazon SES). Se verifica el dominio
  `mimostrador.tech` con registros DNS en Hostinger (SPF, DKIM, DMARC).
- **Trámites:** ninguno más allá de la cuenta.
- **Cuidado:** el email es un dato personal que ya guardamos. No se agregan datos nuevos.

### 2. Avisos a otras apps (webhooks salientes)

**Hecho en octubre de 2026,** junto con una API de solo lectura con claves de acceso. Ver
`docs/API.md`. Eventos de la primera versión: venta cobrada, venta anulada, compra cargada y stock
bajo. Quedan para después: cierre de caja, cliente nuevo y presupuesto creado.

- **Qué resuelve:** cada comercio conecta Mostrador con lo que ya usa, sin que tengamos que
  programar cada integración. Ejemplos: anotar cada venta en una planilla de Google, avisar por
  Telegram cuando algo queda sin stock, mandar el cierre de caja al contador, cargar un cliente
  nuevo en LeadConnector.
- **Cómo:** en Conexiones el comercio pega una dirección (de n8n, Make, Zapier o el "Inbound
  Webhook" de LeadConnector) y elige los eventos: venta cobrada, venta anulada, stock bajo, cierre
  de caja, cliente nuevo, presupuesto creado. Cada aviso va firmado (HMAC) con reintentos.
- **Trámites:** ninguno.
- **Cuidado:** se mandan solo los datos del evento, sin datos de otros clientes. Se registra cada
  envío y se puede pausar.

### 3. Entrada de contactos y pedidos (webhook entrante)

- **Qué resuelve:** el pedido de "leadsconnector de Facebook". LeadConnector es el CRM de
  GoHighLevel; recibe los leads de los anuncios de Facebook e Instagram. Con un webhook entrante,
  cada lead llega a Mostrador como **cliente** (con su teléfono) y, si trae un pedido, como
  **presupuesto** listo para mandar por WhatsApp.
- **Cómo:** cada comercio tiene una dirección propia con una clave secreta. LeadConnector
  (workflow con acción "Webhook"), Zapier, Make o n8n le mandan nombre, teléfono, email y un texto.
  Se evita duplicar por teléfono o email.
- **Trámites:** ninguno. **Así no hace falta pasar la revisión de Meta** (punto 11): la cuenta de
  Facebook del comercio se conecta a LeadConnector, Zapier o Make, que ya están aprobados.
- **Cuidado:** se guardan datos personales de los leads (nombre, teléfono, email). Encaja con la
  tabla de clientes que ya existe, pero hay que confirmarlo antes de empezar y sumar el aviso de
  privacidad.

### 4. Análisis con IA (Claude)

- **Qué resuelve:**
  - **Informe semanal:** qué se vendió más y menos, qué conviene reponer, productos que dejaron de
    moverse, márgenes que bajaron por aumentos de proveedores y horarios con más ventas.
  - **Preguntas en palabras** desde el Tablero: "¿cuánto vendí de gaseosas en septiembre?",
    "¿qué me conviene pedir al proveedor el lunes?".
- **Cómo:** la API de Anthropic con el SDK oficial (`@anthropic-ai/sdk`) desde el servidor. Para
  las preguntas, el modelo usa herramientas que consultan los totales del comercio. No se le pasa
  la base entera. El informe semanal se genera con la API de lotes (Batches), que cuesta la mitad
  y no necesita respuesta inmediata.
- **Modelo y costo (precios de la API al 6/10/2026):**
  - Recomendado: **Claude Opus 5.5** (`claude-opus-5-5`): 4 USD por millón de tokens de entrada y
    20 USD por millón de salida.
  - Más baratos, si la calidad alcanza: Claude Sonnet 5.5 (2 y 10 USD) y Claude Haiku 5.5 (0,10 y
    0,50 USD). Se elige midiendo la calidad con informes reales.
  - El caché de prompts abarata la parte fija de cada pedido.
- **Trámites:** ninguno, solo la cuenta de API.
- **Cuidado:**
  - Se mandan **solo números agregados y nombres de productos**, nunca nombres, teléfonos ni
    emails de clientes.
  - Tope de uso por comercio por mes y registro de cada consulta.
  - Verificar los términos comerciales de la API sobre retención y uso de los datos antes de
    lanzar, y contarlo en la política de privacidad.

### 5. Cobrar la suscripción de Mostrador con Mercado Pago

- **Qué resuelve:** cobrarle el abono a cada comercio todos los meses, sin hacerlo a mano. Si el
  pago falla, el comercio pasa a "prueba vencida" (el estado `estado_suscripcion` ya existe en la
  base).
- **Cómo:** Suscripciones de Mercado Pago (planes y débito automático con tarjeta), con nuestra
  propia cuenta, no la de los comercios. Webhook firmado y reconsulta, como el QR.
- **Trámites:** ninguno extra. Verificar las comisiones vigentes.

### 6. Mercado Libre

- **Qué resuelve:** muchos comercios venden también en Mercado Libre. Una venta allá descuenta el
  stock en Mostrador, y un cambio de stock o de precio en Mostrador se actualiza en la publicación.
- **Cómo:** app propia en el portal de desarrolladores (gratis, con Client ID y secreto). Cada
  vendedor la autoriza con OAuth, igual que Mercado Pago. Se vincula cada publicación con un
  producto (por código o a mano, como las listas de proveedores) y se reciben las notificaciones
  de ventas.
- **Trámites:** en Argentina hay que validar los datos del titular de la cuenta para crear la app.
  **No hace falta la certificación** (Developer Partner Program) para operar; la certificación es
  para tener medallas y pide un volumen de ventas alto (verificar).
- **Esfuerzo:** medio a alto: publicaciones con variantes, límites de pedidos de la API y stock
  reservado.

### 7. Tiendanube

- **Qué resuelve:** el mismo stock para el local y la tienda online. Los pedidos de Tiendanube
  descuentan stock en Mostrador y los precios se suben desde Mostrador.
- **Cómo:** registro gratis como socio tecnológico y una app que cada tienda autoriza. Webhooks de
  pedidos y la API de productos.
- **Trámites:**
  - Una **app privada no pasa homologación**, pero solo se instala en las tiendas que elijamos.
    Sirve para un piloto con los primeros clientes.
  - Para que cualquier tienda la instale desde la tienda de apps de Tiendanube hace falta
    homologarla.
  - El requisito de NubeSDK es solo para apps que agregan código a la tienda; esta no lo necesita.
- **Esfuerzo:** medio.

### 8. Mercado Pago Point (posnet)

- **Qué resuelve:** cobrar con tarjeta desde Vender, y que el posnet reciba el monto sin tipearlo.
- **Cómo:** la API de integraciones de Point con la misma app y los mismos tokens que el QR.
  Verificar si hace falta habilitación adicional y qué modelos de posnet la aceptan.

### 9. Facturación ARCA

- Ya está pensada en `docs/decisiones/010-facturacion-arca.md`. No hace falta ser socio de ARCA:
  cada comercio delega el servicio de Facturación Electrónica en el CUIT de Mostrador.
- **Hace falta antes de programar:**
  - un CUIT propio (por ejemplo, monotributo);
  - contratar el proveedor (Afip SDK u otro);
  - términos y condiciones revisados por un contador y un abogado.
- Es la integración con más riesgo para nosotros: figuramos como representantes ante ARCA. Las
  protecciones de la decisión 010 son obligatorias.

### 10. WhatsApp Business (envío automático)

- **Qué resuelve:** mandar el ticket, el presupuesto o el recordatorio de deuda **sin** que la
  persona toque "Enviar". Hoy se hace con enlaces y alcanza para la mayoría.
- **Trámites:** cuenta de WhatsApp Business verificada por Meta, un número dedicado, plantillas
  aprobadas y costo por conversación. **Dejarlo para cuando haya demanda.**

### 11. Facebook Lead Ads directo

- **Trámites:** la API de Meta pide revisión de la app (permisos `leads_retrieval` y
  `pages_manage_ads`) y verificación de la empresa. El webhook de Meta trae solo el ID del lead, y
  hay que pedir los datos aparte.
- **Recomendación:** no hacerlo al principio. El punto 3 (LeadConnector, Zapier o Make hacia
  nuestro webhook) da el mismo resultado sin la revisión.

## Orden recomendado

1. **Email y "olvidé mi contraseña".** Es la base para crecer sin soporte manual.
2. **Webhooks salientes y entrantes.** Abren decenas de integraciones (LeadConnector, Sheets,
   Telegram, n8n) sin programarlas una por una.
3. **IA: informe semanal y preguntas.** Es el diferencial frente a la competencia.
4. **Suscripción con Mercado Pago.** Para cobrar el abono automáticamente.
5. **Mercado Libre** y después **Tiendanube** (primero como app privada con los pilotos).
6. **ARCA,** cuando estén el CUIT, el proveedor y los términos legales.
7. **WhatsApp Business** y **Point,** según lo que pidan los clientes.

## Fuentes

- Tiendanube, cómo crear una aplicación: https://ayuda.tiendanube.com/es_AR/socios-tecnologicos/como-creo-una-aplicacion-para-tiendanube
- Tiendanube para desarrolladores: https://dev.tiendanube.com/en/docs/applications/overview
- Mercado Libre, registrar una aplicación: https://developers.mercadolibre.com.uy/en_us/register-your-application
- Mercado Libre, Developer Partner Program: https://developers.mercadolibre.com.ar/developer-partner-program
- Meta, Lead Ads: https://developers.facebook.com/docs/marketing-api/guides/lead-ads/
- GoHighLevel/LeadConnector, webhooks y API (fuente de terceros): https://ecosire.com/blog/gohighlevel-webhooks-api-integration
- Delegar un web service en ARCA (ejemplo de otro proveedor): https://yo-facturo.com/blog/como-conectar-yofacturo-con-arca-certificado-digital-y-delegacion/
- Afip SDK: https://docs.afipsdk.com/siguientes-pasos/web-services/factura-mipyme
