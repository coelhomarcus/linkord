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

## Run the checks

There is no hosted CI; run the checks locally before pushing. This runs the server test typecheck, the frontend lint, the server and frontend tests, and the production build (which also typechecks the backend and frontend):

```bash
npm run check
```

None of these need PostgreSQL: `.env.test` supplies a placeholder `DATABASE_URL` and no unit test runs a real query. Use `npm run test:server` or `npm run test:web` to run one side only.

## Create an administrator

After registering with your `REGISTRATION_CODE`, grant the account administrator access from the host:

```bash
npm run admin:grant -- <your-username>
```

## Troubleshooting

- If the database is not ready, check `docker compose -f docker-compose.dev.yml ps` and `docker compose -f docker-compose.dev.yml logs postgres`.
- If port `5432` is already in use, stop the other PostgreSQL service or change the host-side port mapping in `docker-compose.dev.yml` and update `DATABASE_URL` to match.
- If the app cannot connect to PostgreSQL, confirm the container is healthy and that `DATABASE_URL` uses `localhost:5432`, the `linkord` database, and the local credentials above.

## Restarting the server during a call

Restarting the dev server (or deploying) while you are in a call should leave the call running: the clients reconnect and the server restores who was in which call from Postgres (`call_presence`, `dm_calls_active`), waiting `CALL_RESTORE_GRACE_MS` for each client. To try it, join a voice channel with two accounts, stop and start `npm run dev`, and check that both stay connected. Raising `MIN_PROTOCOL_VERSION` in `server/src/realtime/protocolVersion.ts` works against this: open tabs on the old version are refused with `client_outdated`, lose their socket and drop out of the call as far as the server is concerned. Raise it only for a change an old client cannot tolerate.

## End-to-end tests

`e2e/` drives the real app in Chrome with several accounts at once, against a Docker stack shaped like production: the app image behind Traefik, a LiveKit dev server and a throwaway Postgres (`e2e/docker/compose.yml`). Nothing touches the dev database.

Prerequisites: Docker and Google Chrome. Install the suite's own dependencies once (no browser is downloaded; Playwright uses the installed Chrome):

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix e2e
```

Run it:

```bash
npm run test:e2e
```

- `npm run test:e2e:features`: every feature on the working tree's build.
- `npm run test:e2e:restart`: calls, messages and uploads across a redeploy of the same build.
- `npm run test:e2e:upgrade`: tabs opened on the production version (`origin/main`, or `E2E_BASE_REF`) while the server is upgraded to the working tree.

Each run builds `linkord-e2e:head` from the working tree (uncommitted changes included; Docker's cache keeps an unchanged tree fast), starts the stack, runs, and removes it. The base version is built once per commit and reused. `E2E_KEEP_STACK=1` leaves the stack up at `http://localhost:8080`, `E2E_HEADED=1` shows the browsers, `E2E_RETRIES=0` turns retries off, and `E2E_HEAD_IMAGE=<tag>` runs against an image you built yourself instead of the working tree (build a deliberately broken tree to check that a spec catches the regression).

The `upgrade` project adapts to what the base version can do and says so in the report's annotations: if it predates call persistence it expects old tabs to rejoin their call, if its shutdown still disconnects sockets it focuses old tabs to bring them back, and if the working tree raised `MIN_PROTOCOL_VERSION` past the base's protocol it only expects the update screen. A failure keeps a trace, video and screenshot: `npm run report --prefix e2e` opens the HTML report, and `npx playwright show-trace <trace.zip>` (from `e2e/`) replays it step by step.

Specs set up their data through the app's HTTP routes (sign-up, invites, friend requests), never by writing to the database: the app caches memberships in memory and would not see such rows until a restart.

## Profile connections and Wall

The Connections settings support URL, MyAnimeList and GitHub connections. Existing profile links migrate as URL connections; adding a service connection requires its username. Connections are self-declared and do not verify ownership. Only widgets explicitly added and saved by the account owner appear on their Wall. Each connection has a "Show on profile" switch (`show_on_profile`, on by default): turned off, the connection stays in the owner's settings but leaves the public links and the Wall, and its saved widgets come back when it is shown again.

MyAnimeList uses the official API (`https://api.myanimelist.net/v2`), which reads public anime lists with only an application client ID — no user login. Register an app at https://myanimelist.net/apiconfig and set `MAL_CLIENT_ID`; without it MyAnimeList connections stay unavailable. The official API has no favorites endpoint, so the only MyAnimeList widget is recent anime activity (the eight most recently updated list entries, shown as a grid of covers). The worker synchronizes on connection and every twenty-four hours. Private lists and unavailable data are not imported. Failures preserve the last complete snapshot and retry automatically.

GitHub requires no token or OAuth setup. The server reads the public profile through `GET https://api.github.com/users/{username}` and extracts daily contribution counts from the public `https://github.com/users/{username}/contributions` calendar. The calendar is HTML, not a versioned API, so markup changes may require an adapter update; unrecognized or incomplete calendars preserve the previous snapshot. Anonymous REST access is limited to 60 requests per hour per IP. PostgreSQL coordinates one GitHub sync every 65 seconds across server instances, and rate-limit responses postpone the provider until its cooldown expires. Connections share this queue and refresh every twenty-four hours once synced; other traffic sharing the server's outbound IP can reduce the available quota. No credentials, user cookies, or private data are requested.

The worker starts with the API process, checks due connections every minute, and coordinates leases and provider request limits through PostgreSQL. Viewing a profile reads saved snapshots and never contacts the provider APIs. No separate scheduler or Redis service is required. Check `connection-sync` logs for failures; disconnecting deletes the connection snapshot and its widgets.

Connection CRUD uses `/api/me/connections` (`PATCH /api/me/connections/:id` with `{ "showOnProfile": boolean }` and no `value` only changes the visibility); Wall configuration uses `/api/me/wall`, and authorized profile viewers read `/api/users/:userId/wall`. `profileLinks` remains a read-only URL projection in profile payloads, made of the connections shown on the profile. Protocol version 7 requires old clients to reload before changing profiles.
