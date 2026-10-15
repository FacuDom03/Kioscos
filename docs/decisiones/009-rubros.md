# 009. Un sistema para varios rubros

**Fecha:** octubre de 2026 · **Etapa:** I

## Contexto

Recorriendo negocios a pie, el dueño del proyecto encontró más necesidad en ferreterías,
perfumerías y comercios parecidos que en los kioscos. Pidió priorizar eso antes de abrir a
clientes reales, con una condición: **una ferretería no puede verse como un kiosco**. Cada rubro
necesita un diseño más sobrio y funciones que le resuelvan su día a día.

## Decisión

1. **Un solo sistema, con rubro por comercio** (`kioscos.rubro`): kiosco, almacén, ferretería,
   perfumería, librería u otro. La base (cuentas, RLS, caja, ventas, sin conexión, Mercado Pago,
   periféricos) es la misma; cambian el diseño, las categorías sugeridas y las funciones. Mantener
   un sistema por rubro multiplicaría el mantenimiento y la seguridad sin ganar nada. Una
   agencia de autos no entra acá: es otro producto (otra forma de vender, otros datos).
2. **Funciones por comercio** (`kioscos.modulos`): venta por metro/kilo/caja, presupuestos y
   remitos, dos listas de precios, ubicación en el local, actualización de precios con la lista
   del proveedor, cuenta corriente, variantes, promos, regalo y vencimientos. Cada rubro trae
   algunas activadas; el dueño las cambia cuando quiere. La lista vive en
   `packages/shared/src/rubros.ts` y en el check de la base.
3. **Dos estilos** (`data-estilo` en `<html>`):
   - `kiosco` (kiosco, almacén, librería): toldo, cartel estrella con letra de marcador,
     amarillo en precios. Temas Noche, Día, Pizarrón y Alto contraste.
   - `sobrio` (ferretería, perfumería y otro rubro): sin toldo, sin estrella ni marcador, total
     en texto grande, esquinas chicas, letra IBM Plex Sans (Instrument Sans en Boutique). Temas
     Claro, Grafito, Boutique y Alto contraste. Pensado para la PC del mostrador y para mostrar
     más información por pantalla.
     El estilo sale del rubro; el tema sigue siendo por equipo. Si el tema guardado no es del
     estilo del rubro, se aplica el del rubro. `public/tema.js` aplica los dos antes de pintar.
     Los tres temas nuevos pasan el script de contraste y axe como los demás.
4. **El alta**: quien visita el negocio lo da de alta en el panel y marca el rubro; el panel arma
   el enlace para mandar por WhatsApp. El dueño abre el enlace, crea su contraseña y su segundo
   factor, y recién ahí (con sesión) confirma el rubro y elige categorías y funciones
   (`kioscos.configurado = false` hasta que lo hace). Elegir el rubro antes de autenticarse
   obligaría a guardar algo sin sesión; así lo guarda solo el dueño, con permisos y auditoría
   (`kiosco.negocio`).
5. **Cambio compatible**: columnas nuevas con valores por defecto; los comercios que ya existían
   quedan como kiosco y configurados.

## Perfumería (etapa I7)

- **Variantes como productos**: cada tono o tamaño es un producto con su stock, su código y su
  precio, agrupado en `grupos_variantes`. Así el stock, el lector, las compras, el tablero y la
  exportación siguen funcionando sin cambios. En Vender el grupo se ve como un solo mosaico y el
  tono se elige tocándolo (cada toque suma uno).
- **Promos automáticas** (`promos`): cada `lleva` unidades, las `paga` más caras van a precio
  lleno y el resto con `descuento` % menos (3x2, 2x1, segunda al 50%…), sobre una categoría o
  sobre todos los tonos de un producto. La cuenta vive en `@mostrador/shared` y corre igual en el
  equipo (también sin conexión) y en el servidor, que no acepta más descuento del que da la regla
  el día de la venta. Por eso la regla no se edita: se apaga o se le pone fecha de fin. Las
  promos corren solo con la función activada.
- **Regalo y cambios**: la venta para regalo queda marcada y ofrece el ticket de cambio (sin
  precios, con la fecha límite y un código de 8 caracteres que sale del ID de la venta). Un cambio
  es una venta nueva que descuenta lo devuelto al precio que se pagó (con su parte de las promos)
  y lo vuelve al stock. Lo que se lleva tiene que valer lo mismo o más: no se devuelve plata (la
  sección 23 no permite devoluciones automáticas). Anular un cambio lo deshace; anular una venta
  no devuelve dos veces lo que ya volvió con un cambio.
- **Vencimientos por lote** (`lotes`): fecha y cantidad que entró; se marca cuando ya no queda.
  No se descuenta por lote en cada venta (sería pedirle al cajero que elija el lote).

## Datos personales

La cuenta corriente y el fiado necesitan guardar clientes del comercio (nombre, teléfono opcional
y saldo). La sección 23 de la especificación lo dejaba para después de la V1; el dueño del
proyecto dio el OK para adelantarlo (etapa I5). Se guarda lo mínimo, entra en la exportación y en
el borrado de la cuenta, y los teléfonos se redactan en los logs.

## Etapas

Ver la etapa I en la sección 22 de `docs/SPEC.md`.
