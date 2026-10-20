# Modelo de impuestos: cómo lo resuelve Odoo y qué replicamos

Octubre de 2026. Leído del código de la localización argentina de Odoo 18 (`odoo/odoo`:
`addons/l10n_ar`, `addons/l10n_ar_withholding`, `addons/account`) y de los módulos de ADHOC
(`ingadhoc/odoo-argentina`, `ingadhoc/odoo-argentina-ce`), que es lo que usan los estudios
contables con Odoo. `l10n_ar_edi` es de Odoo Enterprise y no se leyó. Complementa
`docs/CONTABILIDAD.md`. Lo marcado "sin verificar" se confirma antes de programarlo.

## La idea de Odoo en una frase

La ley fija los códigos, las alícuotas posibles y los regímenes; **cada empresa configura** qué
impuestos usa, a qué cuenta va cada uno, de qué jurisdicciones es agente, la alícuota de cada
cliente o proveedor (del padrón) y los mínimos. El cálculo es siempre el mismo.

## 1. Impuestos

Cada impuesto tiene: uso (venta, compra, retención a proveedores, retención que nos hacen), forma
de cálculo (porcentaje o importe fijo), alícuota, si el precio ya lo incluye, orden, la **cuenta**
a la que va (una para facturas y otra para notas de crédito) y un **grupo**.

El grupo lleva el código de ARCA:

- **IVA** (`codigo_iva`): 0 No corresponde, 1 No gravado, 2 Exento, 3 0 %, 4 10,5 %, 5 21 %, 6
  27 %, 8 5 %, 9 2,5 %.
- **Tributos** (`codigo_tributo`): 01 Nacionales, 02 Provinciales, 03 Municipales, 04 Internos,
  06 Percepción de IVA, 07 Percepción de IIBB (un grupo por provincia), 08 Percepción municipal,
  09 Otras percepciones (Ganancias), 99 Otros.

Plantillas por condición de la empresa: monotributo (sin IVA), exento y responsable inscripto
(IVA 21 % por defecto en ventas y compras). Las percepciones que aplica un agente vienen
**apagadas** y en 0 %: se prenden solo si la empresa es agente.

## 2. IVA y totales de la factura

- Por línea: base = cantidad × precio. Con precio sin IVA, IVA = base × alícuota; con precio que
  incluye IVA, base = total / (1 + alícuota).
- **Redondeo global** (Odoo lo fuerza con el plan argentino): se suma sin redondear por alícuota,
  se redondea el total y la diferencia se reparte entre líneas. `desgloseIva` de
  `packages/shared/src/factura.ts` ya lo hace así.
- Para ARCA: ImpNeto = bases de IVA con código ≥ 3 (en la C, el neto total); ImpTotConc = base no
  gravada; ImpOpEx = base exenta; ImpIVA = suma de IVA; ImpTrib = suma de tributos; arreglo `Iva`
  uno por alícuota (el 0 % con importe 0); arreglo `Tributos` uno por grupo con su base e importe.
- Si la empresa es responsable inscripto, cada línea lleva **exactamente un** IVA.
- La letra sale de cruzar la condición del emisor con la del comprador: RI emite A a RI y
  monotributo, B a consumidor final y exento; monotributo y exento emiten C. Las B (y C) se
  imprimen con IVA incluido y, en la B, la transparencia fiscal (RG 5614).

## 3. Posiciones fiscales

Según la condición del comprador (RI, monotributo, consumidor final, exento, exterior…) se
reemplazan impuestos: al exterior el IVA pasa a exento; en zona franca, exento. En ADHOC la
posición fiscal también dice **qué percepciones agregar** y de dónde sale la alícuota.

## 4. Percepciones (al vender, solo agentes)

- **Alícuota por cliente y fecha:** tabla cliente + grupo + alícuota + desde/hasta, sin
  solapamientos.
- Si el cliente no tiene una vigente: se busca en el **padrón** de la provincia (ARBA, AGIP,
  Córdoba…) para ese mes y se guarda; si no figura, se usa la alícuota por defecto (la de no
  inscripto). Si la alícuota es 0, no se agrega.
- **Base:** el neto de las líneas (sin IVA). Importe = base × alícuota. Va como tributo 07 y a la
  cuenta "Percepción IIBB aplicada" (pasivo).
- Las notas de crédito usan la fecha de la factura original. Mínimos en percepciones: Odoo no los
  aplica (sin verificar si alguna provincia los exige).

## 5. Retenciones (al pagar a proveedores, solo agentes)

- **Base:** el pago, menos la proporción de IVA de las facturas (pago × neto / total). En IIBB
  sobre el total, el pago entero.
- **Ganancias:** se acumula el mes por régimen y proveedor. Neto = base + bases del mes − mínimo no
  imponible; retención = neto × alícuota, o por escala (fijo + % sobre el excedente del tramo);
  se resta lo ya retenido en el mes.
- **IIBB:** mínimos de pago, de base y de importe, en ese orden.
- Si queda por debajo del mínimo de importe, no se retiene. Cada retención lleva **número de
  certificado** (secuencia propia).
- Asiento: el pago sale por el neto; la retención va a "Retención aplicada" (pasivo) y se guarda
  la base del período para acumular.
- Las alícuotas, mínimos y escalas de la plantilla de Odoo parecen viejos: hay que cargarlos
  vigentes (RG 830 y normas provinciales).

## 6. Plan de cuentas

Códigos de 5 niveles (`1.1.1.01.010`). Monotributo hereda la base, exento suma Ganancias y las
cuentas de agente, responsable inscripto suma IVA.

| Uso                                | Cuenta modelo                                                 |
| ---------------------------------- | ------------------------------------------------------------- |
| Ventas                             | 4.1.1.01.010 Venta de mercadería                              |
| Compras                            | 5.1.1.01.030 Compra de mercadería                             |
| Deudores por ventas                | 1.1.3.01.010                                                  |
| Proveedores                        | 2.1.1.01.010                                                  |
| IVA débito fiscal / crédito fiscal | 2.1.3.03.010 / 1.1.4.04.010                                   |
| Percepciones sufridas              | IVA 1.1.4.04.020 · IIBB 1.1.4.02.0x0 · Ganancias 1.1.4.05.020 |
| Retenciones sufridas               | IVA 1.1.4.04.030 · IIBB 1.1.4.02.0x0 · Ganancias 1.1.4.05.030 |
| Percepciones a pagar (agente)      | IIBB 2.1.3.02.0x0 · IVA 2.1.3.03.040 · Ganancias 2.1.3.04.030 |
| Retenciones a pagar (agente)       | IIBB 2.1.3.02.0x0 · IVA 2.1.3.03.030 · Ganancias 2.1.3.04.020 |

**Cuenta de ingreso de cada línea:** la del producto; si no tiene, la de su categoría (subiendo
por las categorías padre); si no, la de ventas por defecto. La posición fiscal puede reemplazarla.

## 7. Lo que replicamos en Mostrador

**Global (lo mantenemos nosotros, con fecha de vigencia):** grupos con códigos de ARCA,
alícuotas de IVA, regímenes de retención con mínimos y escalas, tabla de topes del monotributo.

**Por comercio:**

- `cuentas`: plan de cuentas cargado desde la plantilla de su condición, editable por el contador.
- `impuestos`: uso, cálculo, alícuota (en diezmilésimos de punto), precio incluido, cuenta,
  grupo, mínimos y secuencia de certificados. Las percepciones y retenciones como agente,
  apagadas.
- Cuenta de ingreso opcional en `categorias` y `productos`, y cuentas por defecto del comercio
  (ventas, caja, Mercado Pago, IVA, percepciones y retenciones sufridas).
- Alícuota de IVA por producto (con la de la categoría por defecto), solo para responsables
  inscriptos.
- Solo si el comercio es agente: alícuota por cliente o proveedor con vigencia (del padrón).
- `asientos` y sus líneas, generados al cobrar, anular y cargar compras.

**Cálculos, todo en centavos enteros** (redondeo al más cercano, los medios lejos del cero):

```
pct(base, t) = redondear(base × t / 1.000.000)        // t en diezmilésimos de %
IVA: por alícuota, base y IVA con redondeo global (desgloseIva)
Percepción: t = alícuota vigente del cliente ?? padrón del mes ?? por defecto; base = neto
Retención: base = pago × neto / total; Ganancias acumula el mes y resta el mínimo no imponible
Asiento de una venta: Debe Caja/Mercado Pago/Deudores por el total;
  Haber ingresos (producto → categoría → comercio) por el neto;
  Haber cada impuesto (IVA débito, percepción aplicada) por su importe
```

**Antes de programar, consultar con el dueño del proyecto:** el padrón de alícuotas guarda CUIT y
razón social de terceros (dato personal nuevo), y las tablas nuevas de cuentas e impuestos.

**Orden propuesto:** primero cuentas y asientos (sirven a todos, también al monotributo), después
IVA por producto y facturas A/B, y al final percepciones y retenciones como agente (pocos
comercios chicos lo son).
