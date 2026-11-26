ARG BUN_VERSION=1.4.5
FROM oven/bun:${BUN_VERSION}-alpine AS bun-base

FROM bun-base AS web-build
WORKDIR /app/web
COPY packages/frontend-shared/package.json /app/packages/frontend-shared/
COPY web/package.json web/bun.lock web/bunfig.toml ./
RUN bun install --frozen-lockfile
COPY packages/frontend-shared/ /app/packages/frontend-shared/
COPY web/ ./
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

FROM bun-base
ENV NODE_ENV=production
WORKDIR /app

# pg_dump and pg_restore for server/dist/scripts/backup.js and restore.js (see "Backup and restore" in docs/DEVELOPMENT.md).
# The client must be at least as new as the database server; the package follows the latest Alpine release.
RUN apk add --no-cache postgresql-client

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=server-build /app/server/dist ./server/dist
COPY server/db/migrations ./server/db/migrations
# One process serves the app, the admin site (on ADMIN_URL's host), the API, uploads and Socket.IO.
COPY --from=web-build /app/web/dist ./web/dist
COPY --from=admin-build /app/admin/dist ./admin/dist

# Keep the application owned by root and preserve UID/GID 1000 for existing upload and backup volumes.
RUN mkdir -p /app/uploads /app/backups && chown bun:bun /app/uploads /app/backups
USER bun

EXPOSE 3000
ENV HOST_BIND=0.0.0.0 PORT=3000 TRUST_PROXY=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1

CMD ["bun", "--no-env-file", "server/dist/index.js"]
