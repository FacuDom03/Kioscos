#!/usr/bin/env bash
# Genera los secretos de producción en /opt/mostrador/secretos (una sola vez).
# Contraseñas en hexadecimal: no hace falta escaparlas en las URLs.
set -euo pipefail
DIR=/opt/mostrador/secretos
sudo mkdir -p "$DIR"
sudo chmod 700 "$DIR"

nuevo() { # nuevo <archivo> <contenido>: no pisa lo que ya existe
  if [ ! -s "$DIR/$1" ]; then
    printf '%s' "$2" | sudo tee "$DIR/$1" >/dev/null
    echo "Creado $1"
  fi
}

nuevo pg_admin "$(openssl rand -hex 24)"
nuevo pg_app "$(openssl rand -hex 24)"
nuevo pg_panel "$(openssl rand -hex 24)"
nuevo redis "$(openssl rand -hex 24)"
nuevo claves.json "{\"actual\":1,\"claves\":{\"1\":\"$(openssl rand -base64 32)\"}}"

PGA=$(sudo cat "$DIR/pg_admin"); PGP=$(sudo cat "$DIR/pg_app"); PGN=$(sudo cat "$DIR/pg_panel"); RDS=$(sudo cat "$DIR/redis")
nuevo database_admin_url "postgres://mostrador_admin:${PGA}@postgres:5432/mostrador"
nuevo database_url "postgres://mostrador_app:${PGP}@postgres:5432/mostrador"
nuevo database_panel_url "postgres://mostrador_panel:${PGN}@postgres:5432/mostrador"
nuevo redis_url "redis://:${RDS}@redis:6379"

# Mercado Pago: se completan a mano cuando tengas la app creada (pueden quedar vacíos).
for s in mp_client_secret mp_webhook_secret; do
  [ -e "$DIR/$s" ] || { sudo touch "$DIR/$s"; echo "Creado $s (vacío: completalo cuando tengas la app de Mercado Pago)"; }
done
# Afip SDK (facturación): se completa con el token de la cuenta (puede quedar vacío).
[ -e "$DIR/afipsdk_token" ] || { sudo touch "$DIR/afipsdk_token"; echo "Creado afipsdk_token (vacío)"; }

# Los contenedores corren como el usuario "node" (uid 1000) y postgres (uid 70).
sudo chown -R root:root "$DIR"
sudo chmod 644 "$DIR"/*
sudo chmod 700 "$DIR"
echo
echo "Listo. Guardá una copia de $DIR/claves.json fuera del servidor (sin ella no se pueden leer los tokens de Mercado Pago ni los códigos de los dueños)."
