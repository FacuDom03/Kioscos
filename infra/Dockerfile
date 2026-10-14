# Imagen de Mostrador. Un solo Dockerfile con dos destinos:
#   --target app  → API, worker, panel admin y migraciones (Node 22 corre TypeScript directo)
#   --target web  → Caddy con la PWA compilada
# Las imágenes base están fijadas por digest (regla 15).
# mirror.gcr.io es el espejo de Docker Hub de Google: misma imagen, sin el límite de descargas.
ARG NODE_IMAGEN=mirror.gcr.io/library/node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ARG CADDY_IMAGEN=mirror.gcr.io/library/caddy:2-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f

FROM ${NODE_IMAGEN} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Dependencias: solo los package.json, para aprovechar la caché.
FROM base AS dependencias
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/servidor/package.json packages/servidor/
COPY packages/mp/package.json packages/mp/
RUN pnpm install --frozen-lockfile

FROM dependencias AS compilacion
COPY . .
RUN pnpm --filter @mostrador/web build

FROM base AS produccion
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/
COPY packages/servidor/package.json packages/servidor/
COPY packages/mp/package.json packages/mp/
RUN pnpm install --frozen-lockfile --prod --filter '!@mostrador/web'

FROM base AS app
ENV NODE_ENV=production
COPY --from=produccion /app/node_modules ./node_modules
COPY --from=produccion /app/apps ./apps
COPY --from=produccion /app/packages ./packages
COPY apps/api/src apps/api/src
COPY apps/worker/src apps/worker/src
COPY apps/admin/src apps/admin/src
COPY apps/admin/public apps/admin/public
COPY packages/shared/src packages/shared/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/servidor/src packages/servidor/src
COPY packages/mp/src packages/mp/src
COPY package.json tsconfig.base.json ./
COPY infra/con-secretos.sh /usr/local/bin/con-secretos
RUN chmod 0755 /usr/local/bin/con-secretos
USER node
ENTRYPOINT ["con-secretos"]
CMD ["node", "apps/api/src/servidor.ts"]

FROM ${CADDY_IMAGEN} AS web
COPY --from=compilacion /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
