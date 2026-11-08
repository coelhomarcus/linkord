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

## Sample data

To get a populated app without clicking through sign-ups, seed the local database:

```bash
npm run db:seed
```

It creates four accounts (`ana`, `bruno`, `carla`, `davi`; the shared password is printed at the end and defined at the top of `server/src/scripts/seedDev.ts`), friendships and a pending request, two DMs, and a server ("Equipe do projeto") with `#geral`, a read-only `#avisos` fed by a webhook, a voice channel and a hoisted moderators role. It runs only with `NODE_ENV=development` (the script sets it) against a database on `localhost`, and is safe to run again: rows that exist are left alone. Restart `npm run dev` afterwards, because the server caches memberships in memory.

## Scripts

Every script runs from the repository root.

| Script | What it does |
| --- | --- |
| `npm run dev` | API (Fastify, `:3000`) and web (Vite, `:5173`) in watch mode. |
| `npm run build` / `npm start` | Production build of both, and the built server. |
| `npm run check` | Everything that should pass before pushing: server test typecheck, web lint, server and web tests, build. |
| `npm run test:server` / `npm run test:web` | Unit tests of one side (`node --test`, Vitest). No database needed. |
| `npm run test:integration` | `server/tests/integration/*.itest.ts` against a throwaway database it creates and drops on your local Postgres. |
| `npm run test:e2e` (and `:features`, `:restart`, `:upgrade`) | The browser suite, see [End-to-end tests](#end-to-end-tests). Needs Docker and Chrome. |
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
| `features/profile` | Display name and bio reaching a friend live, mutual friends. |
| `features/reports-admin` | Reporting a message, the admin deleting it for everyone, suspending an account. |
| `features/settings` | The account's language following it to another browser. |
| `restart/voice` | A voice call survives a redeploy: the tab nobody touched reconnects on its own (the socket drop is a transport close, never `io server disconnect`), and someone joining after the deploy lands in the same call, with audio both ways. |
| `restart/dm-call` | An answered DM call survives a redeploy; a ring survives it and can be answered, even with the click made while the tab is still disconnected. |
| `restart/chat` | A message written while the server is down, and one sent the moment the deploy starts, are stored and shown exactly once. |
| `restart/upload` | A 40 MB upload, throttled to 1 MB/s, survives a 10 s and a 30 s outage, and the stored file is byte for byte the original (sha256). |
| `upgrade/upgrade` | Tabs opened on the production version and tabs on the working tree, after the upgrade: messages both ways, a friend request accepted in an old tab, and the voice call that was going on before the deploy. |

The `restart` specs are the guard for the deploy behaviour described in `AGENTS.md` ("Realtime compatibility and deploys"): built against a tree without the reconnect, upload or DM-answer fixes, they fail.

When you add a user-facing flow, add it to the matching spec (or a new `features/<area>.spec.ts`) and to this table.

## Profile connections and Wall

The Connections settings support URL, MyAnimeList and GitHub connections. Existing profile links migrate as URL connections; adding a service connection requires its username. Connections are self-declared and do not verify ownership. Only widgets explicitly added and saved by the account owner appear on their Wall. Each connection has a "Show on profile" switch (`show_on_profile`, on by default): turned off, the connection stays in the owner's settings but leaves the public links and the Wall, and its saved widgets come back when it is shown again.

MyAnimeList uses the official API (`https://api.myanimelist.net/v2`), which reads public anime lists with only an application client ID — no user login. Register an app at https://myanimelist.net/apiconfig and set `MAL_CLIENT_ID`; without it MyAnimeList connections stay unavailable. The official API has no favorites endpoint, so the only MyAnimeList widget is recent anime activity (the eight most recently updated list entries, shown as a grid of covers). The worker synchronizes on connection and every twenty-four hours. Private lists and unavailable data are not imported. Failures preserve the last complete snapshot and retry automatically.

GitHub requires no token or OAuth setup. The server reads the public profile through `GET https://api.github.com/users/{username}` and extracts daily contribution counts from the public `https://github.com/users/{username}/contributions` calendar. The calendar is HTML, not a versioned API, so markup changes may require an adapter update; unrecognized or incomplete calendars preserve the previous snapshot. Anonymous REST access is limited to 60 requests per hour per IP. PostgreSQL coordinates one GitHub sync every 65 seconds across server instances, and rate-limit responses postpone the provider until its cooldown expires. Connections share this queue and refresh every twenty-four hours once synced; other traffic sharing the server's outbound IP can reduce the available quota. No credentials, user cookies, or private data are requested.

The worker starts with the API process, checks due connections every minute, and coordinates leases and provider request limits through PostgreSQL. Viewing a profile reads saved snapshots and never contacts the provider APIs. No separate scheduler or Redis service is required. Check `connection-sync` logs for failures; disconnecting deletes the connection snapshot and its widgets.

Connection CRUD uses `/api/me/connections` (`PATCH /api/me/connections/:id` with `{ "showOnProfile": boolean }` and no `value` only changes the visibility); Wall configuration uses `/api/me/wall`, and authorized profile viewers read `/api/users/:userId/wall`. `profileLinks` remains a read-only URL projection in profile payloads, made of the connections shown on the profile. Protocol version 7 requires old clients to reload before changing profiles.
