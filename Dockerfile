ARG BUN_VERSION=1.4.5
FROM oven/bun:${BUN_VERSION}-alpine AS bun-base

FROM bun-base AS web-source
WORKDIR /app/web
COPY packages/frontend-shared/package.json /app/packages/frontend-shared/
COPY web/package.json web/bun.lock web/bunfig.toml ./
RUN bun install --frozen-lockfile
COPY packages/frontend-shared/ /app/packages/frontend-shared/
COPY web/ ./

FROM web-source AS web-build
RUN bun run build

FROM bun-base AS admin-build
WORKDIR /app/admin
COPY packages/frontend-shared/package.json /app/packages/frontend-shared/
COPY admin/package.json admin/bun.lock admin/bunfig.toml ./
RUN bun install --frozen-lockfile
COPY packages/frontend-shared/ /app/packages/frontend-shared/
COPY admin/ ./
RUN bun run build

FROM bun-base AS server-build
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile
COPY server/ ./server/
RUN bun run build:server

FROM bun-base AS server-deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile --production

FROM bun-base AS backend
ENV NODE_ENV=production
WORKDIR /app

# pg_dump and pg_restore for server/dist/scripts/backup.js and restore.js (see "Backup and restore" in docs/DEVELOPMENT.md).
# The client must be at least as new as the database server; the package follows the latest Alpine release.
RUN apk add --no-cache postgresql-client

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=server-build /app/server/dist ./server/dist
COPY server/db/migrations ./server/db/migrations

# Keep the application owned by root and preserve UID/GID 1000 for existing upload and backup volumes.
RUN mkdir -p /app/uploads /app/backups && chown bun:bun /app/uploads /app/backups
USER bun

EXPOSE 3000
ENV HOST_BIND=0.0.0.0 PORT=3000 TRUST_PROXY=1 SERVE_WEB=0

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1

CMD ["bun", "--no-env-file", "server/dist/index.js"]

FROM web-build AS web-headers
WORKDIR /app
COPY server/src/http/pageSecurityPolicy.ts ./server/src/http/
COPY server/src/modules/link-preview/playerHosts.ts ./server/src/modules/link-preview/
COPY docker/web/generate-headers.ts ./docker/web/
ARG APP_URL
ARG LIVEKIT_URL=""
ARG KLIPY_ENABLED=0
ARG MEDIA_PROXY=1
ARG CSP_REPORT_ONLY=0
RUN bun --no-env-file docker/web/generate-headers.ts > /app/security-headers.conf

FROM admin-build AS admin-headers
WORKDIR /app
COPY server/src/http/pageSecurityPolicy.ts ./server/src/http/
COPY server/src/modules/link-preview/playerHosts.ts ./server/src/modules/link-preview/
COPY docker/web/generate-headers.ts ./docker/web/
ARG APP_URL
RUN bun --no-env-file docker/web/generate-headers.ts --admin > /app/security-headers.conf

FROM nginxinc/nginx-unprivileged:stable-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03 AS static-web
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/index.html > /dev/null || exit 1

FROM static-web AS frontend
COPY docker/web/public-routes.conf /etc/nginx/overcord-routes/public.conf
COPY --from=web-headers /app/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=web-build /app/web/dist/ /usr/share/nginx/overcord/

FROM static-web AS admin
COPY --from=admin-headers /app/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=admin-build /app/admin/dist/ /usr/share/nginx/overcord/

# Keep the default image usable for Docker Compose and standalone installs.
FROM backend AS monolith
COPY --from=web-build /app/web/dist ./web/dist
ENV SERVE_WEB=1
