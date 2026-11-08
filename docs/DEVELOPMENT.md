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

The example file uses placeholder database credentials, so update `DATABASE_URL` as shown. Set `REGISTRATION_CODE` to a value you can use when creating a local account. `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are only needed for voice, video, and screen sharing; see [Voice and video locally](#voice-and-video-locally).

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

## Voice and video locally

Calls need a LiveKit server. LiveKit Cloud works, but a local dev server in Docker needs no account:

```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0 --node-ip 127.0.0.1
```

Then, in `.env`:

```dotenv
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

`--dev` uses that fixed key pair; `--node-ip 127.0.0.1` makes the media reachable from browsers on this machine. To try a call you need two accounts in separate browser sessions (a normal and a private window, or [Sample data](#sample-data)). This is the same LiveKit setup the end-to-end suite runs.

## Sample data

To get a populated app without clicking through sign-ups, seed the local database:

```bash
npm run db:seed
```

It creates four accounts (`ana`, `bruno`, `carla`, `davi`; the shared password is printed at the end and defined at the top of `server/src/scripts/seedDev.ts`), friendships and a pending request, two DMs, and a server ("Equipe do projeto") with `#geral`, a read-only `#avisos` fed by a webhook, a voice channel and a hoisted moderators role. It runs only with `NODE_ENV=development` (the script sets it) against a database on `localhost`, and is safe to run again: rows that exist are left alone. Restart `npm run dev` afterwards, because the server caches memberships in memory.

## Create an administrator

After registering with your `REGISTRATION_CODE`, grant the account administrator access from the host:

```bash
npm run admin:grant -- <your-username>
```

## Run the checks

There is no hosted CI; run the checks locally before pushing. This runs the server test typecheck, the frontend lint, the dependency audit, the server and frontend tests, and the production build (which also typechecks the backend and frontend):

```bash
npm run check
```

The audit step (`npm run check:audit`) runs `npm audit --omit=dev --audit-level=high` for the root and `web/`, so it fails on a high or critical advisory in anything that ships and needs network access to the npm registry. Dev-only tooling is left out on purpose; `npm audit fix` updates the lockfile within the declared ranges. Keep build-only packages (the shadcn CLI, Tailwind, Vite plugins) in `devDependencies` of `web/`: the Docker image builds the web app with every dependency installed and ships only the output.

None of the tests need PostgreSQL: `.env.test` supplies a placeholder `DATABASE_URL` and no unit test runs a real query. Use `npm run test:server` or `npm run test:web` to run one side only.

## Scripts

Every script runs from the repository root.

| Script | What it does |
| --- | --- |
| `npm run dev` | API (Fastify, `:3000`) and web (Vite, `:5173`) in watch mode. |
| `npm run build` / `npm start` | Production build of both, and the built server. |
| `npm run check` | Everything that should pass before pushing: server test typecheck, web lint, dependency audit, server and web tests, build. |
| `npm run test:server` / `npm run test:web` | Unit tests of one side (`node --test`, Vitest). No database needed. |
| `npm run test:integration` | `server/tests/integration/*.itest.ts` against a throwaway database it creates and drops on your local Postgres. |
| `npm run test:e2e` (and `:features`, `:restart`, `:upgrade`) | The browser suite, see [End-to-end tests](#end-to-end-tests). Needs Docker and Chrome. |
| `npm run check:audit` | `npm audit --omit=dev --audit-level=high` for the root and `web/`; fails on high or critical advisories in shipped dependencies. Part of `npm run check`. |
| `npm run check:dead-code` | `knip`: unused files, exports and dependencies across `server/`, `web/` and `e2e/`. |
| `npm run db:migrate` | Applies pending migrations. The server also does it on boot unless `MIGRATE_ON_BOOT=0`. |
| `npm run db:generate` | Generates a migration from changes to `server/src/db/schema.ts`. Rename the file to describe the change. |
| `npm run db:seed` | Sample data for local development, see [Sample data](#sample-data). |
| `npm run db:studio` | Drizzle Studio, a browser UI over the database in `DATABASE_URL`. |
| `npm run db:preflight` | Read-only inventory of legacy data that would block a migration (exit code 1 means blocked; `-- --json` for machine output). |
| `npm run db:repair` | Repairs the legacy relationship rows `db:preflight` reports, without creating friendships or invitations. |
| `npm run db:rehearse` | Rehearses the migrations on throwaway local databases before they run for real. |
| `npm run admin:grant -- <username>` / `admin:revoke` | Gives or takes administrator access. |

The scripts behind the `db:*`, `admin:*` and `test:integration` commands live in `server/src/scripts/`; each starts with a comment on what it does and how to call it.

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

### How a spec runs

1. Global setup builds the app image and starts the stack (`e2e/stack/`); every test shares it, so tests run one at a time.
2. A spec asks the `users` fixture for accounts (`e2e/fixtures/test.ts`). Each is a real sign-up in its own browser context, with its own cookies and storage, like separate people on separate machines. Chrome gets a fake camera and microphone, so calls carry real audio and video through LiveKit.
3. Data is set up through the app's HTTP routes (`e2e/fixtures/api.ts`: servers, invites, friend requests, channels, permissions), never by writing to the database: the app caches memberships in memory and would not see such rows until a restart.
4. The spec drives the UI by role and pt-BR label (`e2e/fixtures/app.ts`), and checks what a person would see: messages, call tiles, playing audio tracks. It can also wait for a server event to reach a tab (`waitForSocketEvent`) and read the reason of each socket disconnect.
5. Restart and upgrade specs change the server under the open tabs: `deploy()` recreates the app container (SIGTERM, then a new one, like a Dokploy redeploy), `stopApp()`/`startApp()` keep it down for a while.

### What is covered

| Spec | What it checks |
| --- | --- |
| `features/auth` | Sign-up with and without the invitation code, the login form (wrong password refused), session across reloads, logout. |
| `features/friends` | Request from the form accepted in Pending, decline, cancel, block (no messages or calls) and unblock. |
| `features/dm` | Talking in a DM, the unread count until it is opened, no DM without friendship. |
| `features/chat` | Messages shown once on both sides, typing indicator, reply, edit, delete, reactions, search, image attachment. |
| `features/servers` | Creating from the rail, invite link, new channels, a channel hidden from `@everyone`, a read-only channel, kick, ban and unban, deleting the server. |
| `features/voice` | Seeing and hearing each other, mute and camera seen by the other side, leaving, a moderator moving and disconnecting a member. |
| `features/dm-call` | Decline, cancel, an answered call with audio both ways and its line in the chat, a video call. |
| `features/webhooks` | Text and cards through the ingress (token in the URL and in the header), invalid payloads, rotating and deleting the URL, permission. |
| `features/soundboard` | A sound uploaded to the server reaches everyone in the call. |
| `features/profile` | Display name and bio reaching a friend live, mutual friends, the games widgets on offer with no connection (the picker reports the search unavailable, as the stack has no IGDB credentials), games saved with the Wall reaching a friend in order, and widgets reordered by dragging their handle and removed with the button under it. |
| `features/reports-admin` | Reporting a message, the admin deleting it for everyone, suspending an account. |
| `features/settings` | The account's language following it to another browser. |
| `restart/voice` | A voice call survives a redeploy: the tab nobody touched reconnects on its own (the socket drop is a transport close, never `io server disconnect`), and someone joining after the deploy lands in the same call, with audio both ways. |
| `restart/dm-call` | An answered DM call survives a redeploy; a ring survives it and can be answered, even with the click made while the tab is still disconnected. |
| `restart/chat` | A message written while the server is down, and one sent the moment the deploy starts, are stored and shown exactly once. |
| `restart/upload` | A 40 MB upload, throttled to 1 MB/s, survives a 10 s and a 30 s outage, and the stored file is byte for byte the original (sha256). |
| `upgrade/upgrade` | Tabs opened on the production version and tabs on the working tree, after the upgrade: messages both ways, a friend request accepted in an old tab, and the voice call that was going on before the deploy. |

The `restart` specs are the guard for the deploy behaviour described in `AGENTS.md` ("Realtime compatibility and deploys"): built against a tree without the reconnect, upload or DM-answer fixes, they fail.

When you add a user-facing flow, add it to the matching spec (or a new `features/<area>.spec.ts`) and to this table.

## Data retention

Tables that grow with use are trimmed by one daily sweep (`modules/retention/`), started two minutes after boot and then every 24 hours. Each table has its own setting, in days; `0` keeps the records forever. All of them are in `.env.example`.

| Setting | Default | What it trims |
| --- | --- | --- |
| `AUDIT_RETENTION_DAYS` | `0` (forever) | `admin_audit_logs`, by creation time |
| `DATA_REPAIRS_RETENTION_DAYS` | `0` (forever) | `data_repairs`, the log of legacy-data repairs run before a migration. It is small and is the only record of what a repair changed, so it is kept unless you set a limit |
| `NOTIFICATION_READ_RETENTION_DAYS` | `30` | notifications, by the time they were read |
| `NOTIFICATION_UNREAD_RETENTION_DAYS` | `90` | notifications never read, by creation time |
| `OUTBOX_RETENTION_DAYS` | `7` | delivered `outbox_events`, by the time they were delivered. Events that ran out of attempts stay, so an administrator can see them |

Login sessions (deleted when they expire) and chat send operations (a fixed 7 days) have their own cleanup and no setting.

- **Batches:** the sweep deletes at most 1000 rows per statement, oldest first, with a short pause between statements, so a table with a large backlog is never locked for long. The first run after enabling a limit on a big table can therefore take a while; later runs only remove a day's worth.
- **Report:** `/admin/system` lists each table's limit and what the last sweep deleted (the report lives in memory, so it is empty after a restart until the next sweep). A sweep that deleted something, or failed on a table, also leaves a `retention.sweep` entry in the audit log. A table that fails is logged and does not stop the others.
- **Invalid values:** a setting that is not a whole number of days (`-1`, `1.5`, `abc`) stops the server at boot, so a typo cannot silently start or stop deleting an audit trail.
- **New tables:** a table that needs retention (the per-server audit log) calls `registerRetentionTarget` from `modules/retention/retentionTargets.ts` with a `key`, a `days()` reader backed by its own env variable, and a `deleteBatch(cutoff, limit)` that deletes at most `limit` rows older than `cutoff`. The sweep, the admin page and the audit entry pick it up with no other change. Add the variable to `config/env.ts` (through `parseRetentionDays`), to `.env.example` and to the table above, plus a label under `system.retentionTables` in the admin locales.
- **Tests:** `server/tests/modules/retention/` covers the batching and the `0` rule without a database; `server/tests/integration/retention.itest.ts` covers each table against Postgres (`npm run test:integration`).

## Restarting the server during a call

Restarting `npm run dev` (or deploying) while you are in a call should leave the call running: the clients reconnect and the server restores who was in which call. To see it, join a voice channel with two accounts, stop and start `npm run dev`, and check that both stay connected without touching either tab. The rules that keep this working are in `AGENTS.md` ("Realtime compatibility and deploys"), and the `restart` end-to-end specs check it on every run.

## Profile connections and Wall

Connections (Settings → Connections) can be a URL, a MyAnimeList account or a GitHub account. They are self-declared: ownership is not verified. Each has a "Show on profile" switch (`show_on_profile`, on by default); turned off, the connection stays in the owner's settings but leaves the public links and the Wall, and its saved widgets come back when it is shown again. Only widgets the owner added and saved appear on their Wall.

To develop the widgets locally:

- GitHub needs no setup.
- MyAnimeList needs `MAL_CLIENT_ID` (register an app at <https://myanimelist.net/apiconfig>); without it, MyAnimeList connections stay unavailable.
- Syncing runs in the API process: a new connection is fetched within a minute, then every 24 hours. Viewing a profile only reads stored snapshots. Check the `connection-sync` logs when a widget stays empty.

### Games widgets

The four games widgets (favorite game, games I like, games in rotation, want to play) are not tied to a connection: they are always on offer to the owner when editing the Wall, and their data is what the owner picked, kept in `profile_games`. Locally:

- Searching needs `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` (a Twitch developer app, see [INTEGRATIONS.md](INTEGRATIONS.md#igdb)). Without them the widgets still appear and the picker says the search is unavailable, which is what the end-to-end suite sees.
- The lists are saved together with the Wall: `PUT /api/me/wall` takes `{ "widgets": [{ "connectionId": null, "type": "igdb-liked-games" }], "games": { "liked": [<snapshot>] } }`. A list left out of `games` is untouched; a list present replaces the stored one. A snapshot is `{ igdbId, name, slug, coverImageId, releaseYear }`. Lists stay saved when their widget is taken off the Wall.
- `profile_wall_widgets.connection_id` is null for these widgets, so the table also carries `user_id`; the type decides which of the two a row has (a check constraint keeps them consistent).
- `GET /api/games/search?q=` is the search proxy and shares `connection_sync_limits` (the `igdb` row) for its request pacing.
- A tab still running a build from before the games widgets cannot draw one: opening the Wall of someone who added a games widget fails in that tab until it reloads.

API: connections at `/api/me/connections` (`PATCH /api/me/connections/:id` with only `{ "showOnProfile": boolean }` changes the visibility), the Wall layout at `/api/me/wall`, and another user's Wall at `/api/users/:userId/wall`. `profileLinks` in profile payloads is a read-only list of the URLs shown on the profile.

How each provider is called, its limits and what happens when it fails are in [INTEGRATIONS.md](INTEGRATIONS.md#myanimelist) and, for games, [INTEGRATIONS.md](INTEGRATIONS.md#igdb).

## Troubleshooting

- If the database is not ready, check `docker compose -f docker-compose.dev.yml ps` and `docker compose -f docker-compose.dev.yml logs postgres`.
- If port `5432` is already in use, stop the other PostgreSQL service or change the host-side port mapping in `docker-compose.dev.yml` and update `DATABASE_URL` to match.
- If the app cannot connect to PostgreSQL, confirm the container is healthy and that `DATABASE_URL` uses `localhost:5432`, the `linkord` database, and the local credentials above.
