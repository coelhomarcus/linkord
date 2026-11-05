# Local development

Run the frontend and backend directly on your machine. Docker is used only for the local PostgreSQL database; the app itself is not run in a container during development.

## Prerequisites

- Node.js 22 or newer and npm
- Docker with the Compose plugin

## Set up the repository

Install the root and frontend dependencies. This repository has separate lockfiles for the backend/tooling and the web app:

```bash
npm ci
npm ci --prefix web
```

Create the local environment file:

```bash
cp .env.example .env
```

In `.env`, point `DATABASE_URL` at the development database defined by `docker-compose.dev.yml`:

```dotenv
DATABASE_URL=postgres://linkord:linkord@localhost:5432/linkord
DATABASE_SSL=0
COOKIE_SECURE=0
```

The example file uses placeholder database credentials, so update `DATABASE_URL` as shown. Set `REGISTRATION_CODE` to a value you can use when creating a local account. `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are only needed to use voice, video, and screen sharing.

## Start PostgreSQL

Start only the database service:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Wait until the service is healthy:

```bash
docker compose -f docker-compose.dev.yml ps
```

The compose file creates a local `linkord` database with the `linkord` user and password. Its named volume preserves database contents when the container stops.

## Apply migrations and run the app

Apply pending database migrations from the host:

```bash
npm run db:migrate
```

Start the backend and frontend in development mode:

```bash
npm run dev
```

Both processes run locally: Vite serves the web app at [http://localhost:5173](http://localhost:5173), and Fastify serves the API at [http://localhost:3000](http://localhost:3000). Stop the app with `Ctrl+C`. Stop PostgreSQL when you are finished with:

```bash
docker compose -f docker-compose.dev.yml down
```

This keeps the named database volume. Do not add `-v` unless you intend to delete the local database.

## Create an administrator

After registering with your `REGISTRATION_CODE`, grant the account administrator access from the host:

```bash
npm run admin:grant -- <your-username>
```

## Troubleshooting

- If the database is not ready, check `docker compose -f docker-compose.dev.yml ps` and `docker compose -f docker-compose.dev.yml logs postgres`.
- If port `5432` is already in use, stop the other PostgreSQL service or change the host-side port mapping in `docker-compose.dev.yml` and update `DATABASE_URL` to match.
- If the app cannot connect to PostgreSQL, confirm the container is healthy and that `DATABASE_URL` uses `localhost:5432`, the `linkord` database, and the local credentials above.
