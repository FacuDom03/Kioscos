# Facturación electrónica con ARCA: análisis y plan

Análisis de octubre de 2026 para empezar a facturar desde Mostrador. **Decidido el 18/10/2026: se
usa Afip SDK como intermediario** (ver "Afip SDK: cómo funciona hoy"). Completa la decisión
`docs/decisiones/010-facturacion-arca.md`. Lo marcado como **verificar** se confirma con la
documentación vigente de ARCA antes de salir a producción. No es asesoramiento legal ni contable:
antes de facturar para clientes reales, revisarlo con un contador y un abogado.

## En una frase

El comercio **nunca nos da su clave fiscal**: en ARCA autoriza a Mostrador a usar solo el
servicio de Facturación Electrónica, y Mostrador factura cada venta con su propio certificado y el
CUIT del comercio. El comercio puede quitar esa autorización cuando quiera.

## Cómo funciona, de punta a punta

```
Comercio (una vez, en ARCA)          Mostrador (por cada comercio)        Cada venta
──────────────────────────           ─────────────────────────────        ──────────────
1. Crea un punto de venta    ──►     4. Acepta la autorización    ──►     Cobrar
   "Web Services"                    5. La asigna a su certificado        → la venta se guarda
2. Autoriza al CUIT de               6. La app prueba sola que            → la app pide el CAE
   Mostrador (Facturación               ya puede facturar                 → ticket con CAE y QR
   Electrónica)
3. Carga su CUIT y punto de
   venta en Mostrador
```

- **Certificado de Mostrador:** un solo certificado digital, a nombre del CUIT de Mostrador. Sirve
  para todos los comercios que nos autorizaron. Su clave privada se genera en nuestro servidor; con
  Afip SDK viaja a sus servidores (por HTTPS) en cada pedido, así que hay que cuidarla como lo que
  es: la llave para facturar por todos.
- **En cada pedido a ARCA** viaja el CUIT del comercio. ARCA rechaza el pedido si ese comercio no
  autorizó a Mostrador ("Computador no autorizado a acceder al servicio").

## Por qué nunca pedimos la clave fiscal

- Con la clave fiscal se puede hacer **todo** en nombre del comercio: cambiar el domicilio, pedir
  planes de pago, ver sus deudas, darse de baja de impuestos. Con la autorización, Mostrador solo
  puede facturar.
- La clave fiscal es personal. Si la guardáramos, un robo de datos nuestro sería un desastre para
  todos los clientes. Una autorización se revoca en un minuto y no expone nada más.
- Ya está escrito en `docs/SPEC.md` (sección 23): no guardar claves fiscales.

Algunos proveedores ofrecen hacer todo "automático" pidiendo la clave fiscal una vez. **No lo
hacemos**, ni siquiera si va directo al proveedor: el comercio se acostumbraría a entregarla.

## Estado de la implementación (octubre de 2026)

**Hecho, en modo de prueba** (migración `0016_facturacion.sql`):

- **Función "Facturación ARCA"** (módulo `facturacion`): se prende en Tu negocio o en
  Conexiones. Sin prenderla, no aparece nada.
- **Alta guiada** en Más → Facturación ARCA:
  - los pasos en ARCA, con el CUIT de Mostrador para copiar;
  - CUIT con dígito verificador, razón social, condición, punto de venta y domicilio;
  - al guardar se prueba en el momento.
  - En producción, además, revisa que el punto de venta exista como Web Services y que ARCA
    tenga la autorización. Si falta algo, queda "Esperando a ARCA" y se vuelve a probar sola
    cada 15 minutos.
- **Cada venta cobrada crea su factura C pendiente** en la misma transacción. La cola de
  facturas (worker, de a una) le pide el CAE:
  - **Número y fecha:** se lee el próximo número y la fecha mínima; ARCA acepta la fecha real
    hasta 5 días después y, si se pasó, la factura queda rechazada sin inventar otra fecha.
  - **Respuesta perdida:** se consulta antes de reintentar.
  - **Error 10016:** se vuelve a leer el número.
  - **ARCA caída:** reintenta y corta para no insistir.
  - **Rechazo de ARCA:** queda en palabras, con "Reintentar".
- **Ventas cobradas con QR:** la revisión periódica factura las que falten.
- **Anular una venta facturada** crea la nota de crédito. Si todavía no había salido, se cancela.
- **Ventas** muestra el estado de cada factura, el CAE y "Ver en ARCA" (el QR de la
  especificación).
- **Pausar, reanudar y dejar de facturar.** Lo pendiente de una pausa espera y, al dejar de
  facturar, se cancela.
- **Modo de prueba:** sin `AFIPSDK_PRODUCCION=1`, las facturas van al ambiente de pruebas de ARCA
  y se marcan "de prueba, no vale".
  - Sin certificado, salen con el CUIT de pruebas de Afip SDK y cada comercio usa un punto de
    venta de prueba propio.
  - Con el certificado de pruebas de Mostrador (WSASS), salen con el CUIT y el punto de venta del
    comercio. Así probás con tu monotributo (ver "Probar con tu CUIT").

**Para facturar de verdad falta:**

1. Tu CUIT con clave fiscal nivel 3, y el certificado de producción de Mostrador cargado como
   secreto. En `/opt/mostrador/config.env`:
   - `AFIPSDK_PRODUCCION=1`;
   - `MOSTRADOR_CUIT=` con tu CUIT.
2. El ticket impreso con CAE y QR. Hace falta una librería chica para dibujar el QR: es una
   dependencia nueva y se consulta antes.
3. Las protecciones de la decisión 010 en el panel:
   - suspender un comercio;
   - lista de autorizaciones por aceptar;
   - tope diario y alertas.
4. Términos y condiciones firmados.
5. Después: responsables inscriptos (A y B), factura a nombre del cliente (y documento desde
   $10.000.000) y CAEA.

## Lo que tenés que hacer vos (Mostrador), una sola vez

1. **CUIT y clave fiscal nivel 3** a tu nombre o, mejor, a nombre de una empresa (por ejemplo, una
   SAS). Charlarlo con el contador: el que figura como representante de todos los comercios es ese
   CUIT. Para empezar a probar alcanza con tu CUIT personal.
   - El nivel 3 se saca desde la app de ARCA (Herramientas → Solicitud y/o recupero de Clave
     Fiscal, con el DNI y una selfie) o en una oficina.
2. **Darte de alta en el monotributo** (o el régimen que diga el contador) para cobrar el abono.
   Ese mismo alta sirve para que Mostrador facture su propio abono con este sistema.
3. **Certificado de pruebas (homologación):** en ARCA, servicio WSASS ("Autoservicio de Acceso a
   APIs de Homologación"). Te guío paso a paso:
   1. En el servidor generamos la clave privada y el pedido de certificado. La clave no se copia ni
      se pega en ningún lado.
   2. Pegás el pedido en WSASS y descargás el certificado de pruebas.
   3. En WSASS autorizás ese certificado para `wsfe` (facturación) y
      `ws_sr_constancia_inscripcion` (datos de padrón).
4. **Certificado de producción:** lo mismo en "Administración de Certificados Digitales". Ahí se crea
   el "computador fiscal" (un nombre, por ejemplo `mostrador`). Después, en el Administrador de
   Relaciones de Clave Fiscal, se autoriza a ese computador para:
   - `ws_sr_constancia_inscripcion`, para leer los datos de padrón de un CUIT cuando el comercio lo
     carga;
   - `wsfe`, para facturar el abono de Mostrador con tu propio CUIT.
5. **Términos y condiciones** revisados por un abogado. El comercio:
   - autoriza a Mostrador a facturar en su nombre;
   - declara que es el único responsable de lo que factura;
   - acepta que lo suspendamos si hay abuso;
   - acepta que colaboremos con ARCA si lo pide.
6. **Datos de Mostrador para la guía:** el CUIT de Mostrador que el comercio copia en ARCA.

## Probar con tu CUIT (ambiente de pruebas de ARCA)

Con tu monotributo y clave fiscal nivel 3 se factura "de mentira" con tu propio CUIT: nada vale,
pero es exactamente lo que va a pasar en producción. La configuración la leen la API, el worker y
la prueba de conexión del mismo lugar (`packages/servidor/src/entorno-afip.ts`):

| Qué                    | Dónde                                                 | Para qué                                                                    |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Token de Afip SDK      | `/opt/mostrador/secretos/afipsdk_token`               | Sin él, no hay facturación                                                  |
| Certificado y clave    | `/opt/mostrador/secretos/afip/cert.pem` y `clave.pem` | Con ellos se factura con el CUIT del comercio; sin ellos, con el de pruebas |
| `MOSTRADOR_CUIT`       | `/opt/mostrador/config.env`                           | El CUIT de Mostrador (por ahora, el tuyo)                                   |
| `AFIPSDK_PRODUCCION=1` | `/opt/mostrador/config.env`                           | Producción. Sin certificado, la facturación queda apagada                   |

Pasos, una sola vez (el CUIT se escribe solo en la terminal del servidor y la clave privada no sale
de ahí):

1. **En ARCA, adherí el servicio WSASS:** Administrador de Relaciones de Clave Fiscal → Adherir
   servicio → ARCA → Servicios interactivos → "WSASS - Autoservicio de Acceso a APIs de
   Homologación". Si no aparece en "Mis servicios", cerrá sesión y volvé a entrar.
2. **En el servidor, la clave y el pedido de certificado:**

   ```sh
   mkdir -p /opt/mostrador/secretos/afip && cd /opt/mostrador/secretos/afip
   read -r CUIT   # escribí tu CUIT sin guiones y Enter
   openssl genrsa -out clave.pem 2048
   openssl req -new -key clave.pem -subj "/C=AR/O=Mostrador/CN=mostrador/serialNumber=CUIT $CUIT" -out pedido.csr
   cat pedido.csr
   ```

3. **En WSASS, "Nuevo certificado":** nombre `mostrador` y, en "Solicitud de certificado en formato
   PKCS#10", pegá todo lo que mostró `cat pedido.csr` (desde `-----BEGIN` hasta `REQUEST-----`).
   WSASS muestra el certificado: copialo entero y guardalo en el servidor:

   ```sh
   cat > /opt/mostrador/secretos/afip/cert.pem   # pegá el certificado, Enter y Ctrl+D
   ```

4. **En WSASS, "Crear autorización a servicio":** el certificado `mostrador`, tu CUIT como
   representado y el servicio `wsfe` (Facturación electrónica).
5. **Permisos y configuración:**

   ```sh
   cd /opt/mostrador/secretos/afip && rm pedido.csr
   chown -R 1000:1000 . && chmod 700 . && chmod 600 clave.pem cert.pem
   sed -i '/^MOSTRADOR_CUIT=/d' /opt/mostrador/config.env
   echo "MOSTRADOR_CUIT=$CUIT" >> /opt/mostrador/config.env
   ```

   `AFIPSDK_PRODUCCION` queda sin poner (o en 0).

6. **Actualizar el servidor y probar la conexión:** la prueba factura C por $ 100 con tu CUIT en el
   punto de venta 1 (en el ambiente de pruebas no hace falta darlo de alta) y la consulta.
7. **En la app:** prendé "Facturación ARCA" en tu negocio de prueba, cargá tu CUIT, condición
   monotributo y punto de venta 1. Cada venta sale con factura C de prueba con tu CUIT; anulala para
   ver la nota de crédito.

El certificado de pruebas vence a los dos años. Para producción se repite con el de "Administración
de Certificados Digitales" (otro certificado, otra clave).

## Pasar a producción (facturas que valen)

Después de probar con tu CUIT. Producción es para todo el servidor: solo tiene que tener la
facturación prendida tu negocio. Lo pendiente de las pruebas se cancela solo y nunca llega a ARCA.

1. **Punto de venta:** en "Administración de puntos de venta y domicilios", uno del sistema
   "Factura Electrónica – Monotributo – Web Services".
2. **Clave y pedido nuevos, en otra carpeta:**

   ```sh
   mkdir -p /opt/mostrador/secretos/afip-produccion && cd /opt/mostrador/secretos/afip-produccion
   read -r CUIT   # tu CUIT sin guiones y Enter
   openssl genrsa -out clave.pem 2048
   openssl req -new -key clave.pem -subj "/C=AR/O=Mostrador/CN=mostrador/serialNumber=CUIT $CUIT" -out pedido.csr
   cat pedido.csr
   ```

3. **"Administración de Certificados Digitales"** (adherirlo si no está): pide el pedido como
   archivo. Copiá el texto en el Bloc de notas y guardalo como `pedido.csr` (tipo "Todos los
   archivos"). Alias `mostrador`, seleccionar el archivo y "Agregar alias". Después, en el alias,
   descargá el certificado, abrilo con el Bloc de notas y guardalo en el servidor:

   ```sh
   cat > /opt/mostrador/secretos/afip-produccion/cert.pem   # pegar, Enter y Ctrl+D
   cd /opt/mostrador/secretos/afip-produccion
   [ "$(openssl x509 -noout -modulus -in cert.pem)" = "$(openssl rsa -noout -modulus -in clave.pem)" ] && echo "Coinciden" || echo "NO coinciden"
   ```

4. **Autorizar el certificado:** Administrador de Relaciones → "Nueva relación" → ARCA →
   WebServices → Facturación Electrónica → Representante: computador fiscal `mostrador`.
5. **Cambiar de certificado y pasar a producción** (el de pruebas queda guardado en
   `afip-pruebas`):

   ```sh
   cd /opt/mostrador/secretos && mv afip afip-pruebas && mv afip-produccion afip
   cd afip && rm -f pedido.csr && chown -R 1000:1000 . && chmod 700 . && chmod 600 clave.pem cert.pem
   sed -i '/^AFIPSDK_PRODUCCION=/d' /opt/mostrador/config.env
   echo "AFIPSDK_PRODUCCION=1" >> /opt/mostrador/config.env
   ```

   Y actualizar el servidor (el comando de siempre).

6. **En la app:** Facturación ARCA → "Probar ahora". Revisa que el punto de venta sea de Web
   Services y que la autorización esté. Después, una venta chica y su anulación: tienen que
   aparecer la factura C y la nota de crédito C en ARCA → "Mis Comprobantes" → Emitidos.

Para volver a las pruebas: `mv afip afip-produccion && mv afip-pruebas afip`, borrar la línea
`AFIPSDK_PRODUCCION=1` y actualizar.

## Lo que hace cada comercio (alta, unos 10 minutos)

La app lo guía en Más → Conexiones → Facturación, con capturas y botones para copiar:

1. **Su CUIT.** La app consulta el padrón y muestra la razón social, la condición (monotributo o
   responsable inscripto) y el domicilio fiscal para confirmar. Así no hay que tipear casi nada y se
   detectan errores de entrada.
2. **Crear el punto de venta** en ARCA → "Administración de puntos de venta y domicilios". La app
   le dice exactamente cuál elegir, según el padrón:
   - Monotributo: "Factura Electrónica – Monotributo – Web Services".
   - Responsable inscripto: "RECE para aplicativo y Web Services".
   - **No** sirve uno de "Factura en línea" o "Comprobantes en línea" (son para la página de ARCA).
     Carga el número en Mostrador.
3. **Autorizar a Mostrador** en ARCA → "Administrador de Relaciones de Clave Fiscal":
   1. "Nueva relación" (no "Adherir servicio").
   2. Servicio: ARCA → WebServices → Facturación Electrónica.
   3. Representante: el CUIT de Mostrador (botón para copiar).
   4. Si aparece un aviso de que no tiene "computador fiscal", es normal: se confirma igual.
   - Requiere clave fiscal nivel 3.
4. **Listo.** La pantalla queda en "Esperando que ARCA confirme". Apenas Mostrador acepta y la
   prueba pasa, cambia sola a "Facturación activada" y le llega el aviso.

**Datos del ticket** que pide la ley y no vienen todos del padrón (ingresos brutos, inicio de
actividades, nombre de fantasía): se cargan una vez, con lo que se pueda ya completado.

## Lo que hacés vos por cada comercio nuevo (2 minutos)

Según la documentación de varios proveedores que trabajan igual (verificar en la primera alta), la
autorización no queda activa hasta que el representante:

1. **La acepta:** en ARCA → "Aceptación de Designación" → Aceptar.
2. **La asigna al certificado:** en el Administrador de Relaciones, la relación del comercio se
   vincula con el computador fiscal `mostrador`.

El panel de administración te muestra la lista "Comercios esperando aceptación", con el CUIT y la
razón social. Cuando lo hacés, tocás "Ya lo acepté" y la app prueba sola. Si te olvidás, la app
igual reintenta la prueba cada 15 minutos y te recuerda las pendientes.

**¿Se puede automatizar?** Sí, pero solo con tu clave fiscal en un robot que maneje la página de
ARCA, o dándosela a un proveedor (Afip SDK lo ofrece). Al principio conviene hacerlo a mano: son 2
minutos por cliente, y tu clave no queda guardada en ningún lado. Se revisa cuando haya más de diez
altas por semana.

## Baja: cuando el comercio quiere dejar de facturar

- **Desde Mostrador:** Conexiones → Facturación → "Dejar de facturar". Corta en el momento. La app
  le muestra cómo revocar también la autorización en ARCA (recomendado):
  - Administrador de Relaciones → buscar la relación con Mostrador → Revocar.
- **Desde ARCA solamente:** si revoca la autorización sin avisar, la próxima factura vuelve con
  "no autorizado". La app deja de intentar, marca "Desconectada en ARCA" y le avisa al dueño. Las
  ventas siguen funcionando, sin factura.
- **Cuando un comercio se va de Mostrador, o lo suspendemos por abuso:**
  - el panel corta la facturación en el momento;
  - vos revocás la relación desde tu cuenta de ARCA;
  - el comercio puede descargar antes sus facturas.
- **Las facturas emitidas no se borran.** ARCA las tiene en "Mis Comprobantes", y Mostrador las
  incluye en la exportación para el contador.

## Cómo se usa en la app, día a día

- **Cobrar no espera a ARCA.** La venta se guarda como siempre y queda "Pendiente de facturar". Un
  proceso en segundo plano pide el CAE (el número de autorización de ARCA), normalmente en uno o
  dos segundos.
  - Si llega a tiempo, la pantalla Cobrado muestra "Factura C 0003-00000124" y el ticket sale con
    CAE y QR.
  - Si ARCA tarda, sale el ticket común y la factura se puede reimprimir o mandar por WhatsApp
    desde Ventas.
- **Sin internet:** la venta se guarda en el equipo y se factura al sincronizar. Para venta de
  productos, ARCA acepta la fecha de la factura hasta 5 días antes o después del envío, sin pasar
  del mes (manual WSFEv1). La factura sale con la fecha real de la venta. Si se pasa el plazo, la
  app avisa en lugar de facturar con otra fecha (ver "Si ARCA o Afip SDK se caen").
- **Qué factura sale:**
  - **Monotributo:** factura C siempre. Es el primer caso a hacer: es el más común en kioscos y el
    más simple.
  - **Responsable inscripto:**
    - factura A a responsables inscriptos y monotributistas;
    - factura B a consumidores finales y exentos.
    - Hace falta la alícuota de IVA de cada producto (21 %, 10,5 %, etc.). Además van el detalle
      "IVA contenido" y la leyenda del Régimen de Transparencia Fiscal al Consumidor (Ley 27.743).
- **Cliente que pide factura a su nombre:** en Cobrar, "Factura a nombre de…" → CUIT. La app trae
  la razón social y la condición del padrón y elige A, B o C.
  - Si el cliente lo pide para deducir en Ganancias, va con su CUIT aunque el monto sea chico.
- **Consumidor final de $10.000.000 o más:** hay que identificarlo con DNI, CUIL o CDI, o con
  pasaporte si es extranjero (RG 5866/2026, vigente desde el 1/7/2026). Puede pasar en ferreterías.
  La app pide el documento antes de cobrar.
- **Anular una venta facturada** emite una **nota de crédito** del mismo tipo, con el motivo. Los
  cambios con devolución parcial hacen una nota de crédito por lo devuelto. Nunca se borra una
  factura.
- **Ventas** muestra el estado de cada venta en palabras:
  - "Facturada · C 3-124";
  - "Pendiente de facturar";
  - "No se pudo facturar: el punto de venta no existe en ARCA", con el botón "Reintentar".
- **Recategorización del monotributo:** con las ventas que ya tiene la app se muestra lo facturado
  en los últimos 12 meses contra el tope de la categoría. Por ejemplo: "Te faltan $ 2.300.000 para
  pasar a la categoría E". Es un valor agregado fuerte y no pide datos nuevos.

## Cómo no tener problemas: mantenimiento

### Lo que la app vigila sola

| Cada   | Qué revisa                                                     | Si falla                                      |
| ------ | -------------------------------------------------------------- | --------------------------------------------- |
| Minuto | Facturas pendientes hace más de una hora                       | Aviso en el panel                             |
| Minuto | Que ARCA responda (`FEDummy`)                                  | Pausa los envíos y reintenta, sin perder nada |
| Día    | Tope diario y alertas de abuso de cada comercio (decisión 010) | Aviso en el panel y, si es grave, suspende    |
| Mes    | Padrón de cada comercio: condición frente al IVA, CUIT activo  | Le avisa al dueño y pausa si cambió           |
| Mes    | Vencimiento del certificado de Mostrador                       | Aviso 60, 30 y 7 días antes                   |

### Lo que tenés que hacer vos

- **Por cada comercio nuevo:** aceptar y asignar la autorización (2 minutos).
- **Antes de que venza el certificado:**
  - generar uno nuevo y cargarlo, con mi guía;
  - el viejo sigue andando hasta su vencimiento, así que no se corta nada.
  - La app lee la fecha de vencimiento del propio certificado. Hoy suelen durar unos dos años
    (**verificar**).
- **Cuando ARCA cambia las reglas,** actualizar la app. Las que hay que tener en cuenta hoy:
  - **Condición frente al IVA del receptor** (`CondicionIVAReceptorId`). La RG 5616 la vuelve
    obligatoria desde el **1/12/2026**, según el manual WSFEv1 versión 4.8. Desde esa fecha, sin
    ese dato ARCA rechaza la factura. Mostrador la manda desde la primera factura.
  - **RG 5866/2026** (desde el 1/7/2026): reordena el régimen de comprobantes. El tope para
    identificar al consumidor final pasa a $10.000.000.
  - **Transparencia fiscal** (RG 5614, Ley 27.743): solo para responsables inscriptos. Exige el IVA
    contenido y las leyendas en facturas A y B a consumidores finales, monotributistas y exentos.
- **Seguir las novedades:** ARCA publica cambios en su página de web services (manuales con número
  de versión). Al empezar cada sesión de trabajo, o una vez por mes, se revisa si hay una versión
  nueva del manual WSFEv1.
- **Revisar las alertas de abuso** que muestre el panel.

### Lo que hace el código para que no haya facturas mal hechas

- **Numeración sin huecos ni repetidos:** una sola factura a la vez por punto de venta y tipo.
- **Respuesta perdida:** si se corta la conexión mientras ARCA responde, antes de reintentar se le
  pregunta a ARCA si esa factura ya se autorizó (`FECompConsultar`). Así nunca salen dos facturas por
  una venta: es el mismo cuidado que ya tienen los cobros.
- **El importe sale de la venta y no se edita.** Solo se factura una venta real registrada y
  cobrada; no existe "facturar un importe libre".
- **Errores en palabras:** "El punto de venta 3 no es de tipo Web Services. Creá uno nuevo en ARCA
  como explica la guía." Nada de códigos.

## Afip SDK: cómo funciona hoy

Análisis del 18/10/2026. Su sitio de documentación no se pudo abrir desde acá. Por eso se leyó el
código de su librería para Node, `@afipsdk/afip.js` 1.2.3 (febrero de 2026), y se completó con sus
páginas públicas de precios, foro y estado.

**Cómo funciona por dentro:**

- La librería no habla con ARCA: le pide todo a la API de Afip SDK en la nube
  (`app.afipsdk.com`), y ellos hablan con ARCA.
- Se usa una instancia por comercio: `new Afip({ CUIT, cert, key, access_token, production })`. El
  `CUIT` es el del comercio y `cert`/`key` son los de Mostrador (el modelo de delegación que ellos
  mismos recomiendan).
- **Antes de cada operación** (salvo la consulta de estado) manda el certificado **y la clave
  privada** a su servidor para iniciar sesión en ARCA. El permiso de ARCA (un "ticket" que dura 12
  horas) lo guardan ellos. No publican cómo guardan ni cuánto retienen la clave.
- **Métodos que vamos a usar:**
  - `getLastVoucher`: último número autorizado.
  - `createVoucher`: pide el CAE.
  - `getVoucherInfo`: consulta si una factura ya existe.
  - `getSalesPoints`: puntos de venta.
  - `getServerStatus`: estado de ARCA.
  - `executeRequest`: cualquier otro método del servicio de facturación.
- **No vamos a usar `createNextVoucher`.** Hace "último número + 1" en dos pasos, sin bloqueo: con
  dos cajas vendiendo a la vez en el mismo punto de venta, chocan. Mostrador numera con su propia
  cola, una factura a la vez por punto de venta.
- **Sin reintentos:** cada pedido espera hasta 30 segundos y, si falla, devuelve el error. Los
  reintentos los hace nuestro worker.
- **Página de estado** (status.afipsdk.com): mide **su** servicio, no el de ARCA. Registra una
  caída de "Factura electrónica" el 26/09/2026.
- **Automatizaciones:**
  - Pueden crear certificados, autorizar servicios, delegar, aceptar delegaciones y crear puntos de
    venta.
  - **Todas piden usuario y clave fiscal.** Las de delegar y crear el punto de venta piden la clave
    fiscal **del comercio**: no se usan, por lo explicado más arriba.
  - Las de aceptar y autorizar piden la nuestra: por ahora se hacen a mano.
- **Modo de desarrollo:** funciona sin certificado con su CUIT de prueba 20409378472. **Sirve para
  empezar a probar ya, sin trámites en ARCA.**

**Precios** (de su página, sin fecha visible):

| Plan    | Precio      | CUIT  | Pedidos por mes | Excedente                                      |
| ------- | ----------- | ----- | --------------- | ---------------------------------------------- |
| Free    | Gratis      | 1     | 1.000           | No                                             |
| Pro     | 25 USD/mes  | 10    | 10.000          | 10 USD por CUIT y 10 USD cada 1.000 pedidos    |
| Growth  | 80 USD/mes  | 100   | 100.000         | 5 USD por CUIT y 5 USD cada 1.000 pedidos      |
| Startup | 250 USD/mes | 1.000 | 1.000.000       | 1 USD cada 10 CUIT y 1 USD cada 10.000 pedidos |

**Lo que hay que preguntarles por escrito antes de contratar:**

1. **Qué cuenta como "pedido".** Si cuentan el inicio de sesión además de la factura, cada factura
   son 2 pedidos o más. Un kiosco con 150 ventas por día hace unas 4.500 facturas por mes.
   - Con 20 kioscos son 90.000 facturas, en el límite del plan Growth.
   - Con 100 kioscos son entre 450.000 y 900.000 pedidos: plan Startup (250 USD) o excedentes.
2. Si cada CUIT representado (cada comercio) cuenta como un CUIT del plan.
3. Cómo guardan, cifran y cuánto retienen el certificado y la clave. Pedir un acuerdo de
   tratamiento de datos.
4. Si guardan un permiso de ARCA por cada CUIT cuando todos usan el mismo certificado (ARCA no da
   un segundo permiso mientras el primero sigue vigente).
5. Límite de pedidos por segundo.

**Cómo nos cuidamos con Afip SDK:**

- La clave privada vive en el archivo de secretos del servidor, como las otras claves. Nunca en la
  base ni en el repo.
- Si Afip SDK informara un incidente de seguridad: se revoca el certificado en ARCA, se genera otro
  y se carga. Los comercios no tienen que hacer nada, porque la autorización es al CUIT de
  Mostrador, no al certificado (**verificar** en la primera alta si hay que reasignar el
  computador fiscal).
- **Plan B, la conexión directa con ARCA.** Las reglas de factura (`packages/shared/src/factura.ts`)
  no dependen de Afip SDK, y la cola, la numeración y los reintentos son nuestros. Cambiar de camino
  es reemplazar una pieza.

**Sobre "con Afip SDK no tengo que mantener nada":** no es así. Afip SDK solo resuelve la parte de
hablar con ARCA. Igual quedan de nuestro lado:

- el certificado y su renovación;
- aceptar cada autorización;
- las reglas de facturación y los cambios de ARCA;
- la numeración, los reintentos y las notas de crédito;
- qué hacer cuando ARCA se cae;
- los límites y el costo del plan.

## Si ARCA o Afip SDK se caen

ARCA no tiene una página oficial de estado, y su consulta de estado (`FEDummy`) puede decir "OK"
mientras facturar falla. Por eso Mostrador se basa en lo que de verdad pasa con cada factura.

**La regla: la venta nunca se frena.**

1. **Se cobra igual.** La venta, el stock y el "pendiente de facturar" se guardan juntos. El
   cliente se lleva un ticket que dice "Comprobante provisorio: tu factura sale en cuanto ARCA
   responda". Desde Ventas se puede reimprimir o mandar por WhatsApp cuando salga.
2. **Cola con reintentos.** El worker reintenta con espera creciente (30 segundos, 1, 2, 4, 8
   minutos y después cada 15 minutos).
   - Solo reintenta los errores de conexión y de servicio.
   - Si ARCA rechaza la factura por un dato (por ejemplo, un punto de venta mal cargado), no
     reintenta: queda "No se pudo facturar" y le avisa al dueño con palabras claras.
3. **Sin duplicados.** Si se cortó la respuesta, antes de reintentar se consulta si ese número ya
   quedó autorizado (`getVoucherInfo`). Si ya existe, se toma ese CAE.
4. **Corte automático.** Si fallan varias facturas seguidas de un mismo comercio, o ARCA no
   responde, se pausan los envíos de todos y se prueba cada minuto. Al volver, se manda lo
   pendiente en orden (la numeración y las fechas tienen que ser correlativas).
5. **Avisos según el plazo.** ARCA acepta la fecha real de la venta hasta 5 días después, sin pasar
   del mes:
   - **más de una hora pendiente:** aviso en el panel de Mostrador;
   - **más de 24 horas, o fin de mes cerca:** aviso al dueño del comercio;
   - **al cuarto día:** urgente. Si se pasa el plazo, la app no inventa otra fecha: le explica al
     dueño cómo seguir (contingencia de ARCA o contador).
6. **CAEA, la contingencia oficial (segunda etapa).** Desde el 1/8/2026 (RG 5782 y 5785) el CAE en
   línea es la forma única, y el CAEA (CAE anticipado) queda solo para contingencias. Es la primera
   alternativa para quien factura por web service. Cómo funciona:
   - Se pide **antes**: es uno por comercio y por quincena, desde 5 días antes. Durante una caída no
     se puede pedir.
   - Se usa en un **punto de venta aparte**, solo para CAEA, con el mismo domicilio.
   - Se **rinde** cada quincena, hasta 8 días corridos después de terminada. Se informan los
     comprobantes emitidos con ese CAEA, o "sin movimiento". Si no se rinde, ARCA puede negar el
     próximo y aplicar restricciones.
   - Afip SDK tiene `createCAEA` y `getCAEA`. La rendición se hace con `executeRequest`.
   - **Para los monotributistas probablemente aplica** (la norma habla de comprobantes A, B y C).
     **Verificar** con el contador y si hace falta alguna adhesión.
   - En Mostrador:
     - el alta pide un segundo punto de venta;
     - el worker pide el CAEA de cada comercio en cada quincena;
     - se usa solo si ARCA no responde por más de un rato;
     - se rinde solo.
   - Suma pedidos al plan y complejidad: se hace **después del piloto**, si las caídas lo
     justifican.
7. **Último recurso, a mano:** el Facturador o el Facturador Móvil de ARCA, que el comercio usa
   desde su cuenta. Que el talonario de papel siga sirviendo para quien factura por web service es
   **incierto** desde la RG 5785: consultarlo con el contador antes de recomendarlo.

**Si Afip SDK se cae y ARCA no:** pasa lo mismo, la cola espera y reintenta. Es la dependencia
que suma el intermediario. Si llegara a repetirse, el plan B es la conexión directa.

## Plan de pruebas

1. **Fase 0, ya mismo, sin trámites:** Afip SDK en modo de desarrollo, con su CUIT de prueba 20409378472. Sirve para armar la cola, la numeración, los reintentos, el ticket con QR y la
   nota de crédito.
   - El token de la cuenta gratis va en `/opt/mostrador/secretos/afipsdk_token`, cargado con
     `read -rs`. Nunca se pega en el chat.
   - La prueba de conexión es `apps/worker/src/probar-afipsdk.ts`. Se corre con el servicio
     `herramientas`. Consulta el estado de ARCA y el último número, factura C por $ 100, la
     consulta y muestra el QR.
   - El cliente es `packages/servidor/src/afipsdk.ts`. No usa la librería de Afip SDK y guarda el
     permiso de ARCA hasta que vence (unas 12 horas), así el certificado y la clave viajan una
     vez por comercio cada 12 horas y no en cada factura.
2. **Fase 0b, pruebas de ARCA (homologación) con tu CUIT:**
   - Necesita tu CUIT con clave nivel 3 y el certificado de pruebas de WSASS (pasos en "Probar con
     tu CUIT"). El código ya está: con el certificado cargado, todo sale con tu CUIT.
   - Se factura "de mentira" con tu propio CUIT: factura C, nota de crédito C, ARCA caída,
     respuesta perdida y numeración con dos cajas a la vez.
   - No hace falta ningún comercio.
3. **Fase 1, producción con Mostrador:**
   - Certificado de producción.
   - Mostrador factura su propio abono a los clientes (hay que hacerlo igual).
   - Prueba la conexión real sin riesgo para ningún comercio.
4. **Fase 2, piloto:**
   - Uno a tres comercios monotributistas que quieran facturar: solo factura C y nota de crédito C.
   - Dos semanas revisando cada factura en "Mis Comprobantes" de ARCA contra las ventas.
   - Antes de esta fase: términos y condiciones firmados.
5. **Fase 3, responsables inscriptos:**
   - Facturas A y B, IVA por producto, transparencia fiscal y notas de crédito A y B.
6. **Fase 4, contingencia con CAEA,** si las caídas de ARCA lo justifican.

**Listo cuando:**

- en el piloto, cada venta cobrada tiene su factura y la numeración no tiene huecos;
- una anulación genera su nota de crédito;
- con ARCA caída no se pierde ni se duplica nada;
- un comercio que revoca la autorización queda "Desconectado en ARCA" sin afectar a los demás.

## Qué hay que decidir y qué guarda la app

Ya decidido: **Afip SDK** (18/10/2026). Antes de programar la conexión, según `CLAUDE.md`,
necesito tu OK en:

1. **Tablas nuevas:**
   - la configuración fiscal de cada comercio: CUIT, punto de venta, condición y estado;
   - las facturas: venta, tipo, número, CAE, vencimiento y estado.
   - Llevan la misma protección entre comercios que el resto. Hay que cambiar la sección 23 de
     `docs/SPEC.md`, que hoy dice "no crear tablas de comprobantes fiscales en la V1".
2. **Datos personales nuevos:** el CUIT o el DNI del comprador, solo cuando pide factura a su nombre
   o la venta llega a $10.000.000. Entra en la exportación y en el borrado de la cuenta.
3. **Empezar solo con monotributo** (factura C) y dejar responsables inscriptos para la fase 3.

Ya está hecho, sin tocar nada de lo anterior: las reglas de factura en
`packages/shared/src/factura.ts`, con sus pruebas. Incluyen el tipo de factura según quién vende y
quién compra, la nota de crédito que corresponde, el tope de identificación, el QR de ARCA, el
desglose de IVA y la validación del CUIT (dígito verificador). El alta de comercios del panel ya
usa esa validación del CUIT.

## Preguntas para el contador y el abogado

- ¿El representante conviene que sea tu CUIT personal o una empresa? ¿Qué responsabilidad asume el
  representante si un comercio factura mal o abusa?
- Texto de los términos: autorización, responsabilidad del comercio, suspensión, colaboración con
  ARCA.
- Plazo de conservación de las facturas y si Mostrador tiene que guardarlas cuando un comercio se
  va.
- Encuadre de Mostrador (monotributo y categoría) para cobrar el abono.

## Fuentes

- RG 5866/2026, texto oficial: https://www.argentina.gob.ar/normativa/nacional/norma-427092/texto
- RG 5866/2026, resumen del Consejo de Córdoba: https://web.cpcecba.org.ar/arca-reorganiza-el-regimen-de-facturacion-electronica-con-la-rg-5866-a-partir-del-1-de-julio/
- Tope de $10.000.000 para identificar al consumidor final: https://www.derechoenzapatillas.com/2026/normativa-arca-de-facturacion/
- Manual WSFEv1 (RG 4291), condición frente al IVA del receptor: https://www.afip.gob.ar/fe/ayuda/documentos/wsfev1-RG-4291.pdf
- Manual WSFEv1 versión 4.8 (resumen): https://gosocket.net/centro-de-recursos/argentina-arca-publica-la-v4-8-del-manual-del-desarrollador-wsfev1/
- Transparencia fiscal, RG 5614: https://www.argentina.gob.ar/noticias/transparencia-fiscal-partir-de-abril-todas-las-facturas-deberan-detallar-el-iva-en-bienes-y
- WSAA (inicio de sesión con certificado): https://www.afip.gob.ar/ws/documentacion/wsaa.asp
- Certificados digitales: https://www.afip.gob.ar/ws/programadores/certificados-digitales.asp
- Especificación del QR: https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
- Delegación, aceptación y asignación al computador fiscal (proveedor Set-Api): https://www.set-api.com/docs/delegacion-arca
- Aceptar una delegación (guía oficial): https://www.afip.gob.ar/guias/paso-a-paso/Como-delego-servicios-para-que-utilicen-en-mi-nombre-como-se-acepta-delegacion.pdf
- Afip SDK, aceptar delegación: https://docs.afipsdk.com/paso-a-paso/tutoriales-pagina-de-afip/aceptar-delegacion-de-web-service
- Afip SDK, precios y API: https://afipsdk.com/en/api-factura-electronica/
- Constancia de inscripción (padrón): https://www.afip.gob.ar/ws/documentacion/catalogo.asp
- Clave fiscal nivel 3 desde la app: https://fortunaweb.com.ar/blog/clave-fiscal-de-arca-que-es-realmente-y-como-subir-de-nivel-sin-errores
- Afip SDK, librería para Node (código leído): https://www.npmjs.com/package/@afipsdk/afip.js
- Afip SDK, precios: https://afipsdk.com/en/pricing/
- Afip SDK, automatizaciones: https://afipsdk.com/docs/automations/introduction/
- Afip SDK, ir a producción: https://docs.afipsdk.com/siguientes-pasos/ir-a-produccion
- Afip SDK, estado de su servicio: https://status.afipsdk.com/
- ARCA, contingencias de factura electrónica: https://www.afip.gob.ar/fe/emision-autorizacion/contingencias.asp
- RG 5782/2025 (CAE como modalidad única, CAEA para contingencias): https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-5782-2025-419496/texto
- RG 5852/2026 (prórroga a agosto de 2026): https://tributum.news/res-gral-5852-2026-arca-facturacion-electronica-cae-modalidad-unica-caea-ante-contingencias-vigencia-prorroga-a-agosto-2026/
- Manual WSFEv1 (fechas del comprobante): https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG.pdf
