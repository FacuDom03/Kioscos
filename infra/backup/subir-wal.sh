#!/usr/bin/env bash
# Sube los WAL archivados (cada 5 minutos por cron), cifrados con age. Con la copia base diaria,
# permite restaurar a cualquier momento con como mucho 15 minutos de pérdida.
set -euo pipefail
DIR=/opt/mostrador/respaldos
REMOTO=${REMOTO:-respaldos:mostrador}
mkdir -p "$DIR/wal-cifrado"
shopt -s nullglob
for f in "$DIR"/wal/*; do
  nombre=$(basename "$f")
  [ -e "$DIR/wal-cifrado/$nombre.age" ] && continue
  age -R "$DIR/age.pub" < "$f" > "$DIR/wal-cifrado/$nombre.age.tmp" && mv "$DIR/wal-cifrado/$nombre.age.tmp" "$DIR/wal-cifrado/$nombre.age"
done
rclone move "$DIR/wal-cifrado" "$REMOTO/wal" --no-traverse
# Los WAL de más de 2 días ya están en el remoto y en la copia base: se limpian del disco.
find "$DIR/wal" -type f -mmin +2880 -delete
