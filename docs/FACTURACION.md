# Facturación electrónica con ARCA: análisis y plan

Análisis de octubre de 2026 para empezar a facturar desde Mostrador. Completa la decisión
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
  para todos los comercios que nos autorizaron. Su clave privada se genera en nuestro servidor y no
  sale de ahí.
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
- **Sin internet:** la venta se guarda en el equipo y se factura al sincronizar. ARCA acepta la
  fecha de factura unos días hacia atrás (**verificar** el plazo exacto: las fuentes dicen 5 o 10
  días). Si se pasa el plazo, la app avisa en lugar de facturar con otra fecha.
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

| Cada      | Qué revisa                                                     | Si falla                                      |
| --------- | -------------------------------------------------------------- | --------------------------------------------- |
| Minuto    | Facturas pendientes hace más de una hora                       | Aviso en el panel                             |
| 5 minutos | Que ARCA responda (`FEDummy`)                                  | Pausa los envíos y reintenta, sin perder nada |
| Día       | Tope diario y alertas de abuso de cada comercio (decisión 010) | Aviso en el panel y, si es grave, suspende    |
| Mes       | Padrón de cada comercio: condición frente al IVA, CUIT activo  | Le avisa al dueño y pausa si cambió           |
| Mes       | Vencimiento del certificado de Mostrador                       | Aviso 60, 30 y 7 días antes                   |

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

## ¿Afip SDK o conexión directa con ARCA?

Afip SDK es un intermediario: Mostrador le habla a Afip SDK y Afip SDK le habla a ARCA. La
"conexión directa" es que Mostrador le hable a ARCA sin nadie en el medio.

|                                           | Afip SDK                                                                                                                               | Conexión directa                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Costo por mes                             | 25 USD hasta 10 CUIT y 10.000 pedidos; 80 USD hasta 100 CUIT y 100.000 pedidos; 250 USD hasta 1.000 CUIT (de su página, **verificar**) | 0                                                                                                                |
| ¿Alcanza para kioscos?                    | Un kiosco con 150 ventas por día hace unas 4.500 facturas por mes. Con 20 kioscos se pasa de los 100.000 pedidos del plan de 80 USD    | Sin límite (solo los de ARCA)                                                                                    |
| La clave privada del certificado          | Viaja a sus servidores en cada inicio de sesión. Con esa clave se factura por **todos** nuestros comercios                             | No sale de nuestro servidor                                                                                      |
| Programar                                 | Menos: ellos hablan con ARCA                                                                                                           | Unos días más: el inicio de sesión con certificado y los pedidos de facturación                                  |
| Certificado, aceptar autorizaciones       | Igual que directa (o automático entregándoles tu clave fiscal)                                                                         | A mano, 2 minutos por comercio                                                                                   |
| Reglas de facturación (tipos, IVA, topes) | Las mantenemos nosotros igual                                                                                                          | Las mantenemos nosotros                                                                                          |
| Numeración, reintentos, cola, avisos      | Los hacemos nosotros igual                                                                                                             | Los hacemos nosotros                                                                                             |
| Si ARCA cambia su formato                 | Lo absorben ellos                                                                                                                      | Lo ajustamos nosotros (el servicio de facturación es el mismo desde 2010 y los cambios suelen ser campos nuevos) |
| Si el proveedor cae o cierra              | No se factura                                                                                                                          | No aplica                                                                                                        |

**Sobre "con Afip SDK no tengo que mantener nada":** no es así. Afip SDK solo resuelve la parte de
hablar con ARCA. Igual quedan de nuestro lado:

- el certificado y su renovación;
- aceptar cada autorización;
- las reglas de facturación y los cambios de ARCA;
- la numeración, los reintentos y las notas de crédito;
- los límites del plan.

**Recomendación: conexión directa.** No tiene costo fijo, no tiene topes que choquen con el
volumen de un kiosco y la clave que factura por todos nuestros clientes no sale de nuestro
servidor. Se programa sin agregar dependencias, con lo que ya trae Node. Afip SDK queda como plan
B si la conexión directa se complica. Es un cambio respecto de la decisión 010 (que proponía Afip
SDK) y lo decide el dueño del proyecto.

## Plan de pruebas

1. **Fase 0, pruebas de ARCA (homologación):**
   - Necesita tu CUIT con clave nivel 3 y el certificado de pruebas de WSASS.
   - Se factura "de mentira" con tu propio CUIT: factura C, nota de crédito C, ARCA caída,
     respuesta perdida y numeración con dos cajas a la vez.
   - No hace falta ningún comercio.
2. **Fase 1, producción con Mostrador:**
   - Certificado de producción.
   - Mostrador factura su propio abono a los clientes (hay que hacerlo igual).
   - Prueba la conexión real sin riesgo para ningún comercio.
3. **Fase 2, piloto:**
   - Uno a tres comercios monotributistas que quieran facturar: solo factura C y nota de crédito C.
   - Dos semanas revisando cada factura en "Mis Comprobantes" de ARCA contra las ventas.
   - Antes de esta fase: términos y condiciones firmados.
4. **Fase 3, responsables inscriptos:**
   - Facturas A y B, IVA por producto, transparencia fiscal y notas de crédito A y B.

**Listo cuando:**

- en el piloto, cada venta cobrada tiene su factura y la numeración no tiene huecos;
- una anulación genera su nota de crédito;
- con ARCA caída no se pierde ni se duplica nada;
- un comercio que revoca la autorización queda "Desconectado en ARCA" sin afectar a los demás.

## Qué hay que decidir y qué guarda la app

Antes de programar la conexión, según `CLAUDE.md`, necesito tu OK en:

1. **Conexión directa o Afip SDK** (recomendación: directa).
2. **Tablas nuevas:**
   - la configuración fiscal de cada comercio: CUIT, punto de venta, condición y estado;
   - las facturas: venta, tipo, número, CAE, vencimiento y estado.
   - Llevan la misma protección entre comercios que el resto. Hay que cambiar la sección 23 de
     `docs/SPEC.md`, que hoy dice "no crear tablas de comprobantes fiscales en la V1".
3. **Datos personales nuevos:** el CUIT o el DNI del comprador, solo cuando pide factura a su nombre
   o la venta llega a $10.000.000. Entra en la exportación y en el borrado de la cuenta.
4. **Empezar solo con monotributo** (factura C) y dejar responsables inscriptos para la fase 3.

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
