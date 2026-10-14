#!/usr/bin/env bash
# Firewall del VPS (sección 20): entra solo el 443 desde las IP de Cloudflare; SSH y el panel,
# solo por Tailscale. Docker publica puertos salteando ufw, por eso además se filtra en la cadena
# DOCKER-USER. Correr como root después de instalar Docker y Tailscale. Se puede volver a correr
# para actualizar los rangos de Cloudflare.
set -euo pipefail

apt-get install -y ufw ipset >/dev/null

CF4=$(curl -fsS https://www.cloudflare.com/ips-v4)
CF6=$(curl -fsS https://www.cloudflare.com/ips-v6)

# ufw: lo que llega al propio servidor (SSH y panel).
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow in on tailscale0
ufw allow 41641/udp comment 'Tailscale'
for r in $CF4 $CF6; do ufw allow proto tcp from "$r" to any port 443 comment 'Cloudflare'; done
ufw --force enable

# Docker: lo que llega a los contenedores con puertos publicados (Caddy en el 443).
ipset create cloudflare4 hash:net -exist
ipset create cloudflare6 hash:net family inet6 -exist
ipset flush cloudflare4
ipset flush cloudflare6
for r in $CF4; do ipset add cloudflare4 "$r"; done
for r in $CF6; do ipset add cloudflare6 "$r"; done

iptables -N DOCKER-USER 2>/dev/null || true
iptables -F DOCKER-USER
iptables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -A DOCKER-USER -i tailscale0 -j RETURN
iptables -A DOCKER-USER -i docker0 -j RETURN
iptables -A DOCKER-USER -i br+ -j RETURN
iptables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -m set --match-set cloudflare4 src -j RETURN
iptables -A DOCKER-USER -m conntrack --ctstate NEW -j DROP
iptables -A DOCKER-USER -j RETURN

ip6tables -N DOCKER-USER 2>/dev/null || true
ip6tables -F DOCKER-USER
ip6tables -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
ip6tables -A DOCKER-USER -p tcp -m conntrack --ctorigdstport 443 -m set --match-set cloudflare6 src -j RETURN
ip6tables -A DOCKER-USER -m conntrack --ctstate NEW -j DROP
ip6tables -A DOCKER-USER -j RETURN

# Que sobreviva a los reinicios.
mkdir -p /etc/mostrador
ipset save > /etc/mostrador/ipset.conf
iptables-save | sed -n '/^\*filter/,/^COMMIT/p' | grep -E '^(\*filter|:DOCKER-USER|-A DOCKER-USER|COMMIT)' > /etc/mostrador/docker-user.rules
cat > /etc/systemd/system/mostrador-firewall.service <<'UNIDAD'
[Unit]
Description=Firewall de Mostrador (Cloudflare en DOCKER-USER)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'ipset restore -exist < /etc/mostrador/ipset.conf && iptables-restore -n < /etc/mostrador/docker-user.rules'
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIDAD
systemctl daemon-reload
systemctl enable mostrador-firewall.service >/dev/null
echo "Firewall listo: 443 solo desde Cloudflare; SSH y panel solo por Tailscale."
ufw status verbose | head -20
