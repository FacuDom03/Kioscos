# Respaldos

- **Objetivo:** ante una falla total, perder como máximo 15 minutos y volver en menos de 4 horas.
- **Qué se guarda:** WAL archivado cada 5 minutos (`subir-wal.sh`), copia base física diaria y
  copia lógica diaria (`respaldar.sh`). Todo cifrado con [age](https://age-encryption.org) y subido
  con [rclone](https://rclone.org) a otro proveedor (por ejemplo Cloudflare R2 o Backblaze B2).
  Se conserva 30 días.
- **Prueba mensual:** `probar-restauracion.sh` restaura la última copia en un PostgreSQL
  descartable y muestra los totales.

## Cron (crontab de root)

```cron
*/5 * * * * /opt/mostrador/app/infra/backup/subir-wal.sh >> /var/log/mostrador-wal.log 2>&1
40 3 * * *  /opt/mostrador/app/infra/backup/respaldar.sh >> /var/log/mostrador-respaldo.log 2>&1
```

## Restaurar todo en un servidor nuevo (desastre)

1. Instalar el servidor como dice `docs/DEPLOY.md` hasta antes de `docker compose up`.
2. Bajar la última copia base y los WAL: `rclone copy respaldos:mostrador/diarios/base-<fecha>.tar.age .`
   y `rclone copy respaldos:mostrador/wal ./wal`.
3. Descifrar con la clave privada: `age -d -i clave.txt base-<fecha>.tar.age > base.tar`, y cada WAL.
4. Con el volumen de PostgreSQL vacío, extraer `base.tar` (adentro está `base.tar.gz`) en el
   directorio de datos, crear `recovery.signal` y poner en `postgresql.auto.conf`:
   `restore_command = 'cp /wal-restaurar/%f %p'` (montando los WAL descifrados en `/wal-restaurar`).
5. Levantar solo `postgres`, esperar a que termine la recuperación y después el resto.

Para algo más simple (con la pérdida de lo que pasó desde la última copia diaria):
`pg_restore --create` de la copia lógica, como hace `probar-restauracion.sh`.
