#!/bin/sh
# Carga los secretos de archivos: por cada variable NOMBRE_ARCHIVO=/ruta, exporta NOMBRE con el
# contenido del archivo. Así los secretos nunca están en variables del compose ni en el repo.
set -eu
for var in $(env | sed -n 's/^\([A-Z0-9_]*\)_ARCHIVO=.*/\1/p'); do
  case "$var" in
    MOSTRADOR_CLAVES) continue ;; # la app lee este archivo directo
  esac
  archivo=$(printenv "${var}_ARCHIVO")
  if [ -r "$archivo" ]; then
    export "$var=$(cat "$archivo")"
  else
    echo "No se puede leer el secreto $archivo" >&2
    exit 1
  fi
done
exec "$@"
