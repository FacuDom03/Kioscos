# 002. RLS, claves foráneas compuestas y roles de base

**Fecha:** octubre de 2026 · **Etapa:** A

## Contexto

El riesgo más grave del producto es que un kiosco vea datos de otro (sección 8). La spec define
RLS forzada, tres roles y `withKiosco`. Al armar el esquema aparecieron dos huecos que RLS sola
no tapa.

## Decisión

1. **Claves foráneas compuestas.** Toda tabla de negocio tiene `unique (kiosco_id, id)` y las FK
   entre tablas de negocio son `(kiosco_id, x_id) references x (kiosco_id, id)`. Las FK no pasan
   por RLS: con una FK simple, el kiosco A podría guardar un `venta_items` propio apuntando a una
   venta de B si conoce su UUID (y el error o el éxito le confirma que existe).
2. **Las personas se referencian a través de la membresía.** Las columnas de autor
   (`usuario_id`, `abierto_por`, `anulada_por`, etc.) tienen FK a
   `membresias (kiosco_id, usuario_id)`: solo puede figurar alguien del mismo kiosco. La excepción
   es `auditoria.usuario_id`, que también registra al soporte (que no es miembro).
3. **`kioscos` y `usuarios` también tienen RLS.** El kiosco solo se ve a sí mismo; una persona
   se ve solo si tiene membresía en el kiosco de la sesión.
4. **`eventos_webhook` es global** (sin `kiosco_id` ni RLS): los webhooks llegan antes de saber de
   qué kiosco son. Solo guarda el ID del evento y el resultado, nunca datos del pago.
5. **Permisos mínimos por columna.** `mostrador_app` no tiene `UPDATE` sobre `kiosco_id` en
   ninguna tabla (no se puede "mudar" una fila), ni `UPDATE`/`DELETE` en las tablas de solo
   agregar (`auditoria`, `movimientos_stock`, ítems, gastos, compras) ni `DELETE` en ventas y
   pagos. El rol tiene `NOINHERIT` y no es miembro de `mostrador_owner`.
6. **La función `app_kiosco_id()`** lee `app.kiosco_id`. Si no está fijado devuelve `null` y las
   políticas no dejan pasar nada; si tiene un valor que no es UUID, la consulta falla.
7. **Migraciones** en SQL plano, corridas por el administrador con `set local role
mostrador_owner` para que todo quede a nombre del dueño.
8. **`withKiosco` recibe una `BaseApp` opaca:** el tipo no expone Kysely ni el pool, así que
   desde una ruta no hay otra forma de consultar. Además, una regla de ESLint prohíbe importar
   `pg`, `kysely` o `crearBaseApp` en `apps/api/src/routes/`.

## Alternativas

- **Triggers que verifiquen el kiosco del padre:** más código y más lento que una FK compuesta.
- **Un esquema o una base por kiosco:** aislamiento fuerte pero cientos de esquemas para migrar,
  y la spec ya eligió RLS.

## Pendiente para la Etapa B

- El login busca al usuario por email **antes** de saber el kiosco, y la política de `usuarios`
  no lo permite. Hará falta una función `security definer` acotada (por ejemplo,
  `buscar_credenciales(email)`) que devuelva solo lo necesario, o un rol aparte para
  autenticación. Se decide al hacer la etapa y va a su propio registro (toca RLS y roles).
- Alta de usuarios desde el panel admin: mismo problema; necesita un camino propio.
- Los intentos de login fallidos no tienen kiosco: no pueden ir a `auditoria` tal como está.
