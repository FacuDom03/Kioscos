# 003. Plata en centavos: `bigint` en la base, `number` en JS

**Fecha:** octubre de 2026 · **Etapa:** A

## Contexto

La spec pide plata en centavos, `bigint`, nunca `float` (sección 7). `pg` devuelve `int8` como
string, y usar `BigInt` de JS en toda la app complica JSON, React y las cuentas.

## Decisión

- En la base, `bigint` en centavos.
- En JS, `number` entero. El parser de `int8` de `pg` convierte a `number` y **corta con error**
  si el valor no es un entero seguro (más de 2^53, unos 90 billones de pesos), en vez de
  redondear en silencio.
- `formatearPlata` (en `@mostrador/shared`) muestra `$ 1.500` sin decimales si son cero y
  `$ 1.500,50` si los hay, y rechaza montos no enteros.
- Las cantidades de stock son `numeric(12,3)` (por los productos por peso de la balanza) y llegan
  como string.

## Alternativas

- **`BigInt` de JS en todos lados:** no se serializa a JSON sin código extra y no aporta nada a
  la escala de un kiosco.
