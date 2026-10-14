# 004. Dos tokens nuevos para cumplir el contraste: `--line-control` y `--focus`

**Fecha:** octubre de 2026 · **Etapa:** A

## Contexto

El script de contraste de la sección 16.3 pide 3:1 para los bordes de controles contra su
fondo, y la regla dice "si un par no pasa, se ajusta el token, no se baja la regla". Con los
tokens de la spec:

- `--line` y `--line-dashed` quedan entre 1,2:1 y 2,4:1 contra `--bg` y `--surface` en Noche,
  Día y Pizarrón.
- En Día, `--action` (#1DB765) contra `--bg` da 2,31:1, y la sección 17 pide el anillo de foco en
  `--action`.

## Decisión

En lugar de oscurecer `--line` (que se usa en separadores y tarjetas, donde un borde fuerte
cambiaría el aspecto de toda la app), se agregan dos tokens:

| Token            | Noche   | Día     | Pizarrón | Alto contraste | Uso                                                             |
| ---------------- | ------- | ------- | -------- | -------------- | --------------------------------------------------------------- |
| `--line-control` | #64709F | #7E899B | #668E82  | #FFFFFF        | Borde de campos, chips, botones secundarios, tarjetas elegibles |
| `--focus`        | #2ED47A | #0A7A43 | #FF8A3D  | #3DF58B        | Anillo de foco (igual a `--action` salvo en Día)                |

`--line` y `--line-dashed` quedan para separadores decorativos (que no transmiten información).
Todos los pares del script pasan (108 de 108).

## A revisar con diseño

- Si se prefiere, se pueden oscurecer `--line` y `--line-dashed` y borrar `--line-control`.
- El botón principal en Día (`--action` sobre `--bg`, 2,31:1) se identifica por su texto
  (`--action-ink` sobre `--action`, que pasa). Si se quiere que el relleno también pase 3:1, hay
  que oscurecer `--action` en Día.
