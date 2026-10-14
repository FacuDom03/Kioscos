#!/usr/bin/env bash
# Prueba mensual de restauración (sección 20). Baja la última copia lógica, la descifra, la
# restaura en un PostgreSQL de prueba descartable y verifica que estén los datos.
# Uso: AGE_CLAVE=/ruta/a/clave-privada.txt infra/backup/probar-restauracion.sh
set -euo pipefail
REMOTO=${REMOTO:-respaldos:mostrador}
: "${AGE_CLAVE:?Indicá la clave privada de age en AGE_CLAVE (no se guarda en el servidor)}"
TMP=$(mktemp -d)
trap 'docker rm -f mostrador-prueba-restauracion >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

ULTIMO=$(rclone lsf "$REMOTO/diarios" --include 'dump-*.dump.age' | sort | tail -1)
[ -n "$ULTIMO" ] || { echo "No hay copias en $REMOTO/diarios"; exit 1; }
echo "== Restaurando $ULTIMO"
rclone copyto "$REMOTO/diarios/$ULTIMO" "$TMP/copia.age"
age -d -i "$AGE_CLAVE" "$TMP/copia.age" > "$TMP/copia.dump"

docker run -d --rm --name mostrador-prueba-restauracion -e POSTGRES_PASSWORD=prueba \
  mirror.gcr.io/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea >/dev/null
for _ in $(seq 1 30); do docker exec mostrador-prueba-restauracion pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec mostrador-prueba-restauracion psql -U postgres -qc "create role mostrador_admin login superuser; create role mostrador_owner nologin; create role mostrador_app login; create role mostrador_reportes login; create role mostrador_sistema nologin bypassrls; create role mostrador_panel login;" || true
docker exec -i mostrador-prueba-restauracion pg_restore -U postgres -d postgres --create --exit-on-error < "$TMP/copia.dump"

echo "== Verificando"
docker exec mostrador-prueba-restauracion psql -U postgres -d mostrador -At -c "
  select 'kioscos', count(*)::text from kioscos union all
  select 'ventas', count(*)::text from ventas union all
  select 'productos', count(*)::text from productos union all
  select 'última venta', coalesce(max(recibida_en)::text, '-') from ventas union all
  select 'migraciones', count(*)::text from migraciones_aplicadas;"
echo "Restauración probada: OK. Anotá la fecha en el registro de pruebas."
