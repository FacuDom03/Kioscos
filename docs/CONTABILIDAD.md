# Contabilidad, IVA, retenciones y percepciones: análisis y plan

Octubre de 2026. Pedido del dueño del proyecto: que el negocio que factura cargue cada venta con
su cuenta contable (producto, servicio, reparación…), el IVA y lo que corresponda de retenciones
y percepciones, para trabajar con su contador. Investigado en la documentación de Afip SDK, ARCA,
ARBA, AGIP y la ayuda de Xubio, Colppy, Contabilium y Holistor. Lo marcado "sin verificar" se
confirma antes de programarlo. Nada de esto es asesoramiento contable: se revisa con un contador.

## Dos versiones del producto

|                                                | Gestión          | Gestión con facturación                   |
| ---------------------------------------------- | ---------------- | ----------------------------------------- |
| Ventas, stock, caja, compras, clientes         | Sí               | Sí                                        |
| Factura electrónica por venta                  | No               | Sí (función "Facturación ARCA")           |
| Datos fiscales del comercio y términos         | No               | Sí                                        |
| Cuenta contable y alícuota de IVA por producto | No se muestran   | Sí (fases 2 y 3)                          |
| Exportaciones para el contador                 | Ventas y compras | Además: comprobantes, Libro IVA, asientos |

Las dos son el mismo sistema: lo fiscal aparece solo con la función prendida, como ya pasa hoy.

## Lo que encontramos

**Afip SDK no calcula el IVA.** Es un puente a los servicios de ARCA: el sistema calcula neto e
IVA y los manda. Sí sirve para:

- **Padrón** (`ws_sr_constancia_inscripcion`): condición frente al IVA, nombre y domicilio de un
  CUIT. Entra en el mismo plan.
- **Automatizaciones** (Mis Comprobantes, Mis Retenciones, Información de Monotributo): piden el
  usuario y la **clave fiscal** del contribuyente. Mostrador no guarda claves fiscales (reglas 5 y
  6 y la decisión 010), así que quedan afuera.
- **Planes:** Free 1 CUIT y 1.000 pedidos por mes; Pro USD 25 (10 CUIT, 10.000 pedidos); Growth USD
  80 (100 CUIT); Startup USD 250 (1.000 CUIT). Cada comercio que factura es un CUIT.

**IVA en la factura:**

- **Monotributo (factura C):** no se discrimina IVA. ImpTotal = ImpNeto + ImpTrib. La condición
  frente al IVA del comprador (`CondicionIVAReceptorId`) es obligatoria desde el 1/12/2026:
  Mostrador ya la manda.
- **Responsable inscripto (A y B):** IVA por alícuota (códigos de ARCA: 3 = 0 %, 4 = 10,5 %, 5 =
  21 %, 6 = 27 %, 8 = 5 %, 9 = 2,5 %). ImpTotal = no gravado + neto + exento + tributos + IVA. En
  la B a consumidor final, "IVA contenido" y la leyenda de transparencia fiscal (Ley 27.743, RG
  5614). A los monotributistas no les corresponde.
- **Tributos** (percepciones, impuestos internos): van en el arreglo `Tributos` con códigos que se
  leen de ARCA (`FEParamGetTiposTributos`).

**Retenciones y percepciones:**

- **Las que aplica el comercio al vender:** solo si es agente designado. ARBA designa desde
  $7.800 millones de ingresos anuales (RN 7/2026); un kiosco, almacén o ferretería chica casi
  nunca lo es. Fuera de alcance por ahora.
- **Las que sufre:** Mercado Pago y los bancos retienen ingresos brutos (SIRCUPA, SIRTAC,
  SIRCREB) según el padrón de la Comisión Arbitral; y los proveedores que son agentes le cobran
  percepciones en sus facturas. Esto el contador lo necesita para descontarlo: se puede cargar en
  la factura de compra y leer de los reportes de Mercado Pago.

**Libro IVA Digital (RG 4597):** solo para responsables inscriptos. ARCA ya precarga las facturas
electrónicas; el formato de importación es TXT de ancho fijo (comprobantes y alícuotas, ventas y
compras). Generarlo es posible con los datos que ya guardamos.

**Lo que importan los contadores:** el CSV de "Mis Comprobantes" es el formato de hecho (Xubio,
Colppy y Holistor lo aceptan).

**Plan de cuentas:** no hay uno oficial obligatorio. Xubio y Contabilium ponen una cuenta contable
en cada producto, con cuentas por defecto (ventas, caja, IVA débito, percepciones) y generan el
asiento en cada factura. Colppy usa la cuenta del ítem o del cliente.

**Monotributo, topes anuales desde el 1/8/2026:** A $12.009.410 · B $17.595.183 · C $24.670.494 ·
D $30.628.651 · E $36.028.231 · F $45.151.659 · G $53.995.799 · H $81.924.660 · I $91.699.762 · J
$105.012.519 · K $126.610.839. Recategorización hasta el 5 de febrero y el 5 de agosto, con los
últimos 12 meses.

## Plan propuesto

**Fase 1, monotributo (lo que más sirve hoy).** Hechos 1 y 2 (migración
`0019_categoria_monotributo.sql`, `packages/shared/src/monotributo.ts`, Más → Facturación ARCA y
Exportar datos):

1. **Aviso de tope de categoría:** lo facturado en los últimos 12 meses (las notas de crédito
   restan) contra el tope de su categoría, con aviso al 80 % y al 100 %, y recordatorio en enero y
   julio. La tabla de topes se guarda con su fecha de vigencia.
2. **Exportación "como Mis Comprobantes"** en CSV, para que el contador la importe tal cual.
3. **Clasificación de lo vendido:** cada categoría (y, si hace falta, cada producto) dice si es
   mercadería, servicio o reparación. Sirve para el contador y prepara la fase 3.

**Fase 2, responsables inscriptos:**

1. Alícuota de IVA por producto (21, 10,5, 27, 0, exento, no gravado), con la del rubro por
   defecto. El IVA lo calcula Mostrador en centavos, por línea, y lo agrupa por alícuota.
2. Facturas A y B, notas de crédito A y B, y la leyenda de transparencia fiscal.
3. Datos del comprador con el padrón de ARCA (CUIT → nombre y condición).
4. TXT del Libro IVA Digital de ventas y compras.

**Fase 3, contabilidad con el contador:**

1. Plan de cuentas editable con un modelo base.
2. Cuenta contable por categoría o producto, y cuentas por defecto (caja, Mercado Pago, IVA
   débito, percepciones y retenciones sufridas).
3. Percepciones en la factura de compra y retenciones de Mercado Pago (de sus reportes).
4. Exportación de asientos resumidos por día en CSV para Xubio, Colppy u Holistor. Mostrador no
   lleva la contabilidad completa ni presenta declaraciones juradas: eso es del contador.

**Fuera de alcance:** ser agente de percepción o retención, automatizaciones que piden la clave
fiscal, liquidar impuestos.

## Fuentes

- Afip SDK: https://docs.afipsdk.com/paso-a-paso/web-services/padron-de-constancia-de-inscripcion ·
  https://afipsdk.com/docs/automations/introduction/ · https://afipsdk.com/en/pricing/ ·
  https://docs.afipsdk.com/siguientes-pasos/web-services/factura-electronica/factura-a
- WSFE: https://www.afip.gob.ar/ws/documentacion/manuales/manual-desarrollador-ARCA-COMPG-v4-0.pdf
- Condición del receptor: https://www.iprofesional.com/impuestos/464104-nuevo-requisito-arca-puede-trabar-emision-facturas
- Transparencia fiscal: https://www.consejosalta.org.ar/wp-content/uploads/ARCA-5614.pdf
- ARBA agentes 2026: https://siap.blogdelcontador.com.ar/novedades/arba-montos-para-ser-agentes-de-recaudacion-desde-2026/
- ARBA padrón: https://web.arba.gov.ar/regimen-de-recaudacion-por-sujeto
- Mercado Pago IIBB: https://vendedores.mercadolibre.com.ar/nota/retencion-de-iibb-para-monotributistas-en-mercado-pago
- Libro IVA Digital: https://www.afip.gob.ar/iva/documentos/Libro-IVA-Digital-Especificaciones.pdf
- Xubio: https://ayuda.xubio.com/es-ar/como-ingreso-nuevo-producto-venta/ · Contabilium:
  https://ayuda.contabilium.com/hc/es/articles/360013054993
- Monotributo 2026: https://siap.blogdelcontador.com.ar/?p=86452 ·
  https://www.afip.gob.ar/monotributo/categorias.asp
