#!/usr/bin/env bash
# Respaldo diario (regla 3-2-1, sección 20). Lo corre cron todos los días:
#   - copia base física (pg_basebackup) para restaurar a un momento con los WAL archivados;
#   - copia lógica (pg_dump) para restaurar fácil;
#   - todo cifrado con age y subido con rclone a otro proveedor; se conservan 30 días.
# Requiere en el servidor: age, rclone (con un remoto "respaldos:" configurado) y la clave
# pública de age en /opt/mostrador/respaldos/age.pub (la privada se guarda FUERA del servidor).
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/opt/mostrador/respaldos
REMOTO=${REMOTO:-respaldos:mostrador}
FECHA=$(date -u +%Y%m%dT%H%M%SZ)
COMPOSE="docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env"
mkdir -p "$DIR/salida"

echo "== Copia lógica"
$COMPOSE exec -T postgres pg_dump -U mostrador_admin -d mostrador -Fc --no-owner \
  | age -R "$DIR/age.pub" > "$DIR/salida/dump-$FECHA.dump.age"

echo "== Copia base"
$COMPOSE exec -T postgres sh -c "rm -rf /respaldos/actual && pg_basebackup -U mostrador_admin -D /respaldos/actual -Ft -z -X none -c fast"
tar -C "$DIR/base/actual" -cf - . | age -R "$DIR/age.pub" > "$DIR/salida/base-$FECHA.tar.age"

echo "== Subida"
rclone copy "$DIR/salida" "$REMOTO/diarios" --no-traverse
rm -f "$DIR/salida"/*.age
rclone delete "$REMOTO/diarios" --min-age 30d
rclone delete "$REMOTO/wal" --min-age 31d

echo "Respaldo $FECHA listo"
