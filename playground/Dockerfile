# The playground service's image, apart from the app's (the Dockerfile at the repo root). Build it from the
# repo root, which holds the lockfile it installs from:
#   docker build -f playground/Dockerfile .
# See "Playground service" in docs/DEPLOY.md.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY playground/ ./playground/
RUN npm run build:playground

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/playground/dist ./playground/dist
COPY playground/db/migrations ./playground/db/migrations

# The code stays owned by root and only readable by `node`; the service writes nothing to disk (its state is in
# its own database).
USER node

EXPOSE 3000
ENV HOST_BIND=0.0.0.0 PLAYGROUND_PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz > /dev/null || exit 1

CMD ["node", "playground/dist/index.js"]
