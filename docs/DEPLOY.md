# Deploy en el VPS (Hostinger KVM 4, Ubuntu LTS)

Guía paso a paso para poner Mostrador en producción. Todo se hace una sola vez, salvo
"Actualizar" al final. Tiempo estimado: 1 a 2 horas.

Lo que vas a necesitar:

- El VPS con Ubuntu 24.04 LTS y acceso root por SSH.
- Un dominio (por ejemplo `app.tukiosco.com.ar`) con el DNS en **Cloudflare** (plan gratis).
- Una cuenta de **Tailscale** (gratis) para entrar al servidor y al panel admin.
- Un lugar para los respaldos en otro proveedor (por ejemplo **Cloudflare R2** o **Backblaze B2**).
- Opcional: la app de **Mercado Pago** creada en "Tus integraciones" para cobrar con QR.

---

## 1. Preparar el servidor

Entrá por SSH como root (la primera vez, con la contraseña o la llave que te dio Hostinger):

```sh
apt-get update && apt-get -y upgrade
apt-get install -y ca-certificates curl git unattended-upgrades age rclone ufw ipset
dpkg-reconfigure -plow unattended-upgrades   # actualizaciones de seguridad automáticas: "Sí"

# Usuario sin root para trabajar
adduser --disabled-password --gecos "" mostrador
usermod -aG sudo mostrador
mkdir -p /home/mostrador/.ssh && cp ~/.ssh/authorized_keys /home/mostrador/.ssh/ && chown -R mostrador: /home/mostrador/.ssh
echo 'mostrador ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/mostrador
```

### Docker

```sh
curl -fsSL https://get.docker.com | sh
usermod -aG docker mostrador
```

### Tailscale

```sh
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh
tailscale ip -4      # anotá esta IP (100.x.y.z): es TAILSCALE_IP
```

Desde tu compu (con Tailscale instalado y logueado con la misma cuenta) probá
`ssh mostrador@100.x.y.z`. Cuando funcione, cerrá el SSH público:

```sh
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh
```

Activá MFA en Tailscale, Hostinger, Cloudflare, GitHub y Mercado Pago.

---

## 2. Cloudflare

1. En Cloudflare, agregá un registro **A** `app` → la IP pública del VPS, con la **nube naranja**
   (proxy) prendida.
2. **SSL/TLS → Overview**: modo **Full (strict)**.
3. **SSL/TLS → Origin Server → Create Certificate** (RSA, 15 años, para `app.tukiosco.com.ar`).
   Guardá el certificado y la clave en el servidor:

   ```sh
   sudo mkdir -p /opt/mostrador/certificados
   sudo nano /opt/mostrador/certificados/origen.pem   # pegá el certificado
   sudo nano /opt/mostrador/certificados/origen.key   # pegá la clave privada
   sudo chmod 644 /opt/mostrador/certificados/origen.pem
   sudo chmod 600 /opt/mostrador/certificados/origen.key
   ```

4. **Security → WAF**: dejá las reglas administradas prendidas. En **Security → WAF → Rate
   limiting rules** agregá una regla: ruta que empieza con `/api/v1/auth/`, 30 pedidos por minuto
   por IP, bloquear 10 minutos.
5. **Speed → Optimization**: apagá "Rocket Loader" (rompe la CSP).

---

## 3. Bajar el código y preparar los secretos

```sh
sudo mkdir -p /opt/mostrador && sudo chown mostrador: /opt/mostrador
cd /opt/mostrador
git clone -b claude/mostrador-etapa-a-7jft9w https://github.com/FacuDom03/Kioscos.git app
cd app
bash infra/preparar-secretos.sh
```

El código está en la rama `claude/mostrador-etapa-a-7jft9w` (si después la pasás a `main`, cloná
esa). Si el repositorio es privado, el servidor necesita permiso para leerlo: lo más simple es
una clave de solo lectura. En el servidor, `ssh-keygen -t ed25519 -f ~/.ssh/kioscos -N ''`, pegá
`~/.ssh/kioscos.pub` en GitHub → el repositorio → Settings → Deploy keys (sin permiso de
escritura) y cloná con
`GIT_SSH_COMMAND='ssh -i ~/.ssh/kioscos' git clone -b claude/mostrador-etapa-a-7jft9w git@github.com:FacuDom03/Kioscos.git app`.

Configuración (no secreta):

```sh
cat > /opt/mostrador/config.env <<'CONF'
DOMINIO=app.tukiosco.com.ar
TAILSCALE_IP=100.x.y.z
APP_NOMBRE=Mostrador
# Mercado Pago (dejalo vacío si todavía no lo vas a usar)
MP_CLIENT_ID=
MP_PRUEBAS=0
CONF
```

Carpetas de respaldos (PostgreSQL corre con el usuario 70 dentro del contenedor):

```sh
sudo mkdir -p /opt/mostrador/respaldos/{wal,base}
sudo chown 70:70 /opt/mostrador/respaldos/wal /opt/mostrador/respaldos/base
```

**Guardá una copia de `/opt/mostrador/secretos/claves.json` fuera del servidor** (en tu gestor de
contraseñas). Sin ese archivo no se pueden leer los tokens de Mercado Pago ni los segundos factores.

---

## 4. Firewall

```sh
sudo bash infra/firewall.sh
```

Deja entrar solo el 443 desde Cloudflare (también para los contenedores de Docker) y SSH y el panel
solo por Tailscale.

---

## 5. Levantar todo

```sh
cd /opt/mostrador/app/infra
docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env up -d --build
docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env ps
```

Tienen que quedar `postgres`, `redis`, `api` (healthy), `web` y `admin` andando. `migrar` corre las
migraciones y termina. `worker` termina solo si Mercado Pago no está configurado.

Probá en el navegador `https://app.tukiosco.com.ar`: tiene que abrir la pantalla de ingreso.

### Crear tu usuario del panel admin

```sh
docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env run --rm herramientas \
  node apps/admin/src/crear-admin.ts vos@tumail.com
```

Te pide una contraseña y te muestra un secreto: cargalo en Google Authenticator (o similar).
Entrá al panel desde tu compu con Tailscale: `http://100.x.y.z:8081`.

### Dar de alta el primer kiosco

En el panel: **Alta de comercio** → nombre, rubro (kiosco, almacén, ferretería, perfumería,
librería u otro), plan y email del dueño → **Crear y generar invitación**. Mandale el enlace por
WhatsApp (vence en 72 horas). El dueño elige su contraseña y su segundo paso (huella o app de
códigos), confirma el rubro y elige sus categorías y funciones (fiado, presupuestos, tonos,
promos…), abre la caja y ya puede vender. El rubro define el diseño: una ferretería o una
perfumería no se ven como un kiosco. Desde **Más → Dispositivos** autoriza la PC del mostrador y
desde **Más → Usuarios** crea a los cajeros con PIN.

---

## 6. Mercado Pago (cobro con QR)

1. En [Tus integraciones](https://www.mercadopago.com.ar/developers/panel/app) creá una aplicación
   (producto: "Pagos presenciales / QR", modelo con **OAuth**).
2. **URL de redireccionamiento**: `https://app.tukiosco.com.ar/api/v1/mp/callback`. Activá
   **PKCE**.
3. **Webhooks**: URL `https://app.tukiosco.com.ar/api/v1/webhooks/mercadopago`, evento
   **Order (Mercado Pago)**. Copiá la **clave secreta** de webhooks.
4. En el servidor:

   ```sh
   printf '%s' 'CLIENT_SECRET_DE_LA_APP' | sudo tee /opt/mostrador/secretos/mp_client_secret >/dev/null
   printf '%s' 'CLAVE_SECRETA_WEBHOOKS'  | sudo tee /opt/mostrador/secretos/mp_webhook_secret >/dev/null
   sudo sed -i 's/^MP_CLIENT_ID=.*/MP_CLIENT_ID=EL_CLIENT_ID/' /opt/mostrador/config.env
   # Para probar primero con cuentas de prueba de Mercado Pago: MP_PRUEBAS=1
   docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env up -d
   ```

5. **Antes de conectar un kiosco real**, probá con el entorno de pruebas de Mercado Pago y **dos
   cuentas de vendedor de prueba**: conectar, cobrar con QR, pagar con una cuenta compradora de
   prueba, cancelar y dejar vencer (ver `docs/decisiones/007-mercado-pago.md`).
6. El dueño conecta su cuenta desde **Más → Conexiones → Conectar Mercado Pago**.

---

## 7. Respaldos

> PostgreSQL guarda un archivo de cambios (WAL) cada 5 minutos en `/opt/mostrador/respaldos/wal`
> desde el primer día. Si todavía no configurás estos respaldos, agregá al cron de root una
> limpieza para que no llenen el disco:
> `0 * * * * find /opt/mostrador/respaldos/wal -type f -mmin +2880 -delete`

1. Creá un bucket en R2 o B2 y configurá rclone con un remoto llamado `respaldos`:
   `rclone config` (para que además vaya cifrado del lado del proveedor podés usar un remoto
   "crypt" encima; igual los archivos ya van cifrados con age).
2. Clave de cifrado: **generala en tu compu, no en el servidor**:
   `age-keygen -o mostrador-respaldos.key` y guardá ese archivo en lugar seguro. Copiá solo la
   línea "public key" al servidor: `echo 'age1…' | sudo tee /opt/mostrador/respaldos/age.pub`.
3. Cron (como root, `sudo crontab -e`):

   ```cron
   */5 * * * * /opt/mostrador/app/infra/backup/subir-wal.sh >> /var/log/mostrador-wal.log 2>&1
   40 3 * * *  /opt/mostrador/app/infra/backup/respaldar.sh >> /var/log/mostrador-respaldo.log 2>&1
   ```

4. **Una vez por mes**, desde una compu con la clave privada (o en el servidor pasándola un rato):
   `AGE_CLAVE=mostrador-respaldos.key infra/backup/probar-restauracion.sh`. Tiene que mostrar los
   totales y "Restauración probada: OK". Más detalles en `infra/backup/README.md`.

---

## 8. Monitoreo

- **Disponibilidad**: en [UptimeRobot](https://uptimerobot.com) o
  [Better Stack](https://betterstack.com) (gratis), un chequeo HTTPS cada minuto a
  `https://app.tukiosco.com.ar/` con alerta a la app del celular.
- **Respaldos**: en [Healthchecks.io](https://healthchecks.io) creá un chequeo diario y agregá al
  final de la línea de cron de `respaldar.sh`: `&& curl -fsS https://hc-ping.com/<tu-uuid>`.
- **Logs**: `docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env logs -f api`.
  Los logs no tienen contraseñas, tokens, PIN, emails ni CUIT.

---

## Variante: servidor que ya tiene Traefik (Hostinger con otras apps)

Si el VPS ya corre apps con el administrador de Docker de Hostinger, los puertos 80 y 443 son de
Traefik. Mostrador se pone detrás: Traefik saca el certificado de Let's Encrypt y le pasa lo que
llega para su dominio. Las otras apps no se tocan. Cambia esto respecto de los pasos de arriba:

- **No hace falta Tailscale ni el certificado de Cloudflare.** El dominio de Mostrador tiene que
  apuntar directo al VPS (registro A; si está en Cloudflare, con la nube gris), porque Let's
  Encrypt valida por el puerto 80.
- **No corras `infra/firewall.sh`**: cerraría las otras apps. Usá el firewall del hPanel (VPS →
  Firewall): aceptar 22, 80 y 443, y descartar el resto (revisá antes qué puertos usan tus apps).
- En `/opt/mostrador/config.env` poné `TAILSCALE_IP=127.0.0.1`: el panel admin queda solo dentro
  del servidor. Para entrar, desde tu compu: `ssh -L 8081:127.0.0.1:8081 root@IP-DEL-VPS` y abrí
  `http://127.0.0.1:8081`.
- Con 4 GB de memoria y otras apps, sumá 2 GB de swap (una vez):
  `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab`
- Siempre con los dos archivos:

  ```sh
  cd /opt/mostrador/app/infra
  docker compose -f compose.prod.yml -f compose.traefik.yml --env-file /opt/mostrador/config.env up -d --build
  ```

---

## Actualizar a una versión nueva

```sh
cd /opt/mostrador/app && git pull
cd infra && docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env up -d --build
```

Las migraciones corren solas antes de levantar la API (`migrar` termina con "Migraciones
aplicadas: …" o "Base al día"; si falla, no se levanta la API nueva). Cada migración corre en su
propia transacción.
Son compatibles: los comercios que ya existían quedan como kiosco, con su diseño de siempre. La
app de los kioscos muestra "Hay una versión nueva" y se actualiza cuando no hay un ticket abierto
o al cerrar la caja.

Antes de actualizar, por las dudas, un respaldo a mano (paso 7) y mirá que termine bien:

```sh
docker compose -f compose.prod.yml --env-file /opt/mostrador/config.env logs migrar
```

---

## Antes de abrir a clientes reales (sección 18)

- [ ] CI en verde (incluida la prueba de aislamiento entre kioscos).
- [ ] Escaneo con OWASP ZAP: en GitHub, Actions → "Escaneo ZAP" → Run workflow con la URL.
- [ ] Revisión del código contra las reglas de `CLAUDE.md`.
- [ ] Restauración de un respaldo probada de punta a punta (paso 7.4).
- [ ] MFA en Cloudflare, Hostinger, GitHub, Mercado Pago, Tailscale y el panel admin.
- [ ] Mercado Pago probado en el entorno de pruebas con dos vendedores (paso 6.5).
- [ ] Probado en un celular Android real, una PC con Windows, un lector USB y una impresora
      térmica (Etapa G).
- [ ] Términos, privacidad y acuerdo de tratamiento de datos revisados por un abogado.
