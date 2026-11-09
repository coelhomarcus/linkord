FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./server/
RUN npm run build:server

FROM node:22-alpine AS server-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# pg_dump and pg_restore for server/dist/scripts/backup.js and restore.js (see "Backup and restore" in docs/DEVELOPMENT.md).
# The client must be at least as new as the database server; the package follows the latest Alpine release.
RUN apk add --no-cache postgresql-client

COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=server-build /app/server/dist ./server/dist
COPY server/db/migrations ./server/db/migrations
COPY --from=web-build /app/web/dist ./web/dist

# The code above stays owned by root and is only readable by `node`, so a compromised process (an image
# parsing bug in sharp, say) cannot rewrite the JavaScript served to everyone. The only places the app writes
# are the upload folder and the backups folder. A named volume copies these owners on first use; a bind mount
# keeps the host folder's owner, which is why docs/DEPLOY.md asks for `chown -R 1000:1000` (the uid of `node`).
RUN mkdir -p /app/uploads /app/backups && chown node:node /app/uploads /app/backups
USER node

EXPOSE 3000
ENV HOST_BIND=0.0.0.0 PORT=3000 TRUST_PROXY=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1

CMD ["node", "server/dist/index.js"]
