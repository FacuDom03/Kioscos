# 010. Facturación electrónica ARCA: delegación, sin guardar claves fiscales (borrador)

**Estado:** en marcha (octubre de 2026). Módulo de facturación en modo de prueba, con tablas
(migración 0016), cola de facturas y alta guiada. Ver "Estado de la implementación" en
`docs/FACTURACION.md`. Lo que sigue de este documento era el borrador original.
Es un acuerdo de diseño con el dueño del proyecto, no una decisión cerrada: lo marcado como
"verificar" se confirma con la documentación vigente antes de programar. Nada de esto es
asesoramiento legal: antes de lanzar, revisarlo con un contador y un abogado.

## Objetivo

Que un comercio active la facturación electrónica con el mínimo de pasos y que Mostrador nunca
tenga en su poder lo que permite facturar a nombre del comercio (certificados, claves privadas o
claves fiscales). La facturación es opcional: sin activarla, el comercio opera como hoy y el ticket
sigue diciendo "Documento no válido como factura".

## Decisión

1. **Intermediario:** se usa **Afip SDK** (o un proveedor equivalente) y la contratación la hace
   Mostrador. A futuro, si el negocio funciona, el plan para 100 CUIT. Cada comercio no crea cuenta
   en ningún proveedor.
2. **Autorización por delegación en ARCA**, una sola vez por comercio:
   1. El comercio crea en ARCA un punto de venta de tipo Web Services y anota el número.
   2. En el Administrador de Relaciones de Clave Fiscal autoriza a **el CUIT de Mostrador** como
      representante para el servicio de Facturación Electrónica.
   3. En Mostrador carga su CUIT, el número de punto de venta y su condición frente al IVA.
      Mostrador guía esos pasos en pantalla, con capturas y nuestro CUIT para copiar.
3. **Mejora posible:** que el proveedor cree el certificado y el punto de venta pidiendo la clave
   fiscal una sola vez. Solo se acepta si esa clave va **directo al proveedor** y nunca pasa por
   nuestros servidores ni por nuestros registros. Si no se puede garantizar, no se hace.
4. **Qué guardamos (y qué no):**
   - Sí: CUIT, punto de venta y condición frente al IVA del comercio; el estado de la autorización;
     por cada comprobante: venta, tipo, número, CAE, vencimiento del CAE, estado y último error.
   - Sí, cifrado con la clave maestra fuera de la base: el acceso de Mostrador al proveedor
     (igual que los tokens de Mercado Pago).
   - **No:** certificados ni claves privadas de los comercios, ni sus claves fiscales.
   - Hay que cambiar la sección 23 de `docs/SPEC.md` ("no crear tablas de comprobantes fiscales en
     la V1") y la regla de los datos de la sección 18 al empezar la Fase 3, con el OK del dueño del
     proyecto. Según `CLAUDE.md`, antes de empezar hay que preguntar: toca el modelo de datos,
     guarda un dato personal nuevo y suma una dependencia.
5. **La venta no espera a la factura.** Se cobra como siempre y queda "pendiente de facturar". Un
   proceso en segundo plano la envía y reintenta si ARCA o el proveedor fallan. Si el error es del
   comercio (por ejemplo, no autorizó nuestro CUIT), se le avisa con palabras claras. Las ventas
   hechas sin internet se facturan al sincronizarse.
6. **Al activar**, se hace una consulta de prueba al proveedor para comprobar que la autorización
   existe; recién ahí se habilita. El comercio se entera en el momento y no en la primera factura.
7. **Tipos de comprobante:** monotributista, factura C; responsable inscripto, A o B según el
   cliente. Las anulaciones y devoluciones se resuelven con **nota de crédito**, prevista desde el
   comienzo.

## Protección contra abusos (requisitos, no mejoras opcionales)

Mostrador figura ante ARCA como representante de muchos comercios. Si alguien abusa del sistema
(facturas apócrifas, facturas a quien no compró), nos pueden pedir explicaciones y se daña la
reputación. No se puede saber si una venta ocurrió en la realidad, así que se reduce el riesgo:

1. Solo se factura **una venta real registrada y cobrada** en Mostrador. No existe "facturar un
   importe libre".
2. El importe de la factura es el de la venta y **no se edita** después de emitida.
3. Las correcciones se hacen con **nota de crédito**. Nunca se borra ni se reescribe.
4. **Registro completo** e inmodificable en la auditoría: quién emitió qué, cuándo y desde qué
   dispositivo, para poder responderle a ARCA.
5. **Alertas** para revisión manual: muchas facturas en poco tiempo, montos altos y repetidos,
   facturas a un mismo cliente sin ventas reales, muchas anulaciones.
6. **Tope diario** configurable por comercio.
7. **Suspender un comercio al instante** desde el panel de administración. Además, el comercio puede
   revocar la autorización desde ARCA.
8. Verificar al activar que la autorización existe (prueba de que controla ese CUIT).
9. **Aislamiento entre comercios:** una factura del comercio A nunca sale con el CUIT del B. Entra
   en `apps/api/test/casos-aislamiento.ts` y se prueba con dos comercios.
10. Fuera del código: **términos y condiciones** donde el comercio declara que es el único
    responsable de lo que factura, acepta que podamos suspenderlo y que colaboremos con ARCA si lo
    pide. Revisar con un abogado si conviene un seguro o una figura que nos proteja.

Alternativa de menor riesgo, si la exposición resulta demasiado alta: que cada comercio traiga su
propio proveedor y pegue en Mostrador solo una clave de acceso, cifrada y revocable. Mostrador nunca
actuaría en nombre del comercio. Es más incómodo para el cliente.

## Cómo se prueba

- Entornos de prueba de ARCA y del proveedor, con CUITs de prueba. No hace falta CUIT propio para
  desarrollar.
- Antes de salir: dos comercios con autorizaciones distintas, factura por cada tipo de comprobante,
  nota de crédito, ARCA caída (la venta no se bloquea y se reintenta) y autorización revocada.
- Para salir a producción hace falta un CUIT para contratar el plan (el dueño del proyecto tiene que
  darse de alta, por ejemplo en el monotributo). Verificar qué más pide el proveedor.

## A verificar antes de programar

- Que Afip SDK permita facturar en nombre de otros CUIT por delegación, con el plan que se quiera
  contratar, y cómo se opera. Qué se necesita de nuestro lado (CUIT, certificado).
- Si la autorización del comercio se puede verificar por API (para la prueba de activación).
- Precio vigente del plan, topes por cantidad de comprobantes y condiciones. Los números de
  referencia que se mencionaron (unos 25 USD por mes hasta 10 CUIT; un adicional de 3.000 a 5.000
  pesos por comercio) **no están confirmados**. Con el plan de 100 CUIT, el adicional al comercio
  tiene que cubrir el costo fijo desde el primer cliente.
- Quién responde ante ARCA ante un error o un abuso: términos y responsabilidades con un contador.
- Reglas de identificación del consumidor final por monto, y desglose de IVA por tipo de comprobante.

## Actualización de octubre de 2026

El análisis completo está en `docs/FACTURACION.md`. Lo que cambia o se confirma:

- **La autorización tiene un paso nuestro:** después de que el comercio autoriza a Mostrador, hay
  que aceptarla ("Aceptación de Designación") y asignarla al computador fiscal de Mostrador. Se
  hace a mano, 2 minutos por comercio, avisado desde el panel. Automatizarlo exige nuestra clave
  fiscal en un robot o en un proveedor; por ahora, no.
- **Afip SDK recibe la clave privada** del certificado antes de cada operación, y sus planes se
  cuentan por pedidos. Se propuso la conexión directa, pero **el dueño del proyecto eligió Afip SDK
  (18/10/2026)**. Antes de contratar hay que preguntarles por escrito qué cuenta como pedido, si
  cada comercio cuenta como CUIT del plan, y cómo guardan la clave (acuerdo de tratamiento de
  datos). La conexión directa queda como plan B.
- **No se usa `createNextVoucher`** (choca con dos cajas a la vez): numeramos con nuestra cola.
- **ARCA caída:**
  - La venta nunca se frena y la factura se reintenta.
  - ARCA acepta la fecha real hasta 5 días después, sin pasar del mes.
  - El CAEA (RG 5782 y 5785, desde el 1/8/2026) es la contingencia oficial para una segunda etapa.
  - Ver `docs/FACTURACION.md`.
- **El punto 3 ("mejora posible" con la clave fiscal del comercio) queda descartado.**
- **Reglas vigentes:**
  - Identificar al consumidor final desde $10.000.000 (RG 5866/2026).
  - `CondicionIVAReceptorId` obligatorio desde el 1/12/2026 (manual WSFEv1 versión 4.8).
  - Transparencia fiscal solo para responsables inscriptos.
- **Hecho sin tocar el modelo de datos:** `packages/shared/src/factura.ts`, con sus pruebas:
  - tipo de comprobante y nota de crédito;
  - campos de WSFEv1;
  - desglose de IVA;
  - QR;
  - tope de identificación;
  - CUIT con dígito verificador, que el alta del panel ya valida.

## Referencias

- `docs/SPEC.md`: Fase 3 (sección 22), tarjeta "Facturación ARCA, Próximamente" en Conexiones y
  la sección 23 ("No hacer").
- `docs/decisiones/007-mercado-pago.md`: mismo patrón de tokens cifrados, reconsulta y worker.
