# Local development

Run the frontend and backend on your machine, with the services they need (PostgreSQL, LiveKit and a mail sink) from [`docker-compose.yml`](../docker-compose.yml). The same file can also run the app itself in a container: see [the whole stack in Docker](#the-whole-stack-in-docker).

## Prerequisites

- Node.js 22 or newer and npm
- Docker with the Compose plugin

## Set up the repository

The backend/tooling and the web app have separate lockfiles:

```bash
npm ci
npm ci --prefix web
cp .env.example .env
```

In `.env`, point the app at the services from `docker-compose.yml`, and set `REGISTRATION_CODE` to a code you will use to sign up:

```dotenv
DATABASE_URL=postgres://linkord:linkord@localhost:5432/linkord
DATABASE_SSL=0
COOKIE_SECURE=0
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

The `LIVEKIT_*` values are only needed for calls ([Voice and video locally](#voice-and-video-locally)).

## Start the services

```bash
docker compose up -d
docker compose ps   # wait until they are healthy
```

Published on `127.0.0.1` only:

- `postgres` (17) on 5432, with a `linkord` database, user and password, kept in the `linkord-dev_postgres_data` volume.
- `livekit` on 7880 (signalling), 7881/tcp and 7882/udp (media).
- `mailsink` on 8025, which prints the emails the app would send ([Emailed codes locally](#emailed-codes-locally)).

For fighting in [playground channels](#playground-channels), also start the playground service's own database (the `playground` profile, which `docker compose up -d` leaves out): `docker compose up -d playground-postgres` publishes it on 5433, kept in the `linkord-dev_playground_postgres_data` volume.

Compose also reads `.env`, which is how LiveKit gets the same `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` the app signs tokens with (unset, `devkey` and `secret`).

## Apply migrations and run the app

```bash
npm run db:migrate
npm run dev
```

Vite serves the web app at [http://localhost:5173](http://localhost:5173) and Fastify the API at [http://localhost:3000](http://localhost:3000). `npm run dev` also starts the playground service on 3100, which migrates its own database when it starts; without `PLAYGROUND_URL`, `PLAYGROUND_SECRET` and `PLAYGROUND_DATABASE_URL` in `.env` it says so in the log and stays off, and playground channels open as ordinary voice channels. To turn it on locally:

```dotenv
PLAYGROUND_URL=http://localhost:5173
PLAYGROUND_SECRET=<openssl rand -hex 32>
PLAYGROUND_DATABASE_URL=postgres://linkord:linkord@localhost:5433/linkord_playground
# optional: the app calls the service directly rather than through Vite
PLAYGROUND_INTERNAL_URL=http://localhost:3100
```

When you are done, `docker compose down` stops the services and keeps the database; `-v` would delete it.

## Voice and video locally

The `livekit` service is enough (LiveKit Cloud works too). With the `LIVEKIT_*` values above, browsers on this machine connect to `ws://localhost:7880` and receive media from `127.0.0.1` (`LIVEKIT_NODE_IP`). A call needs two accounts in separate browser sessions (a normal and a private window, or [Sample data](#sample-data)).

LiveKit warns that `secret` is too short and starts anyway. To silence it, put a secret of 32 characters or more (`openssl rand -hex 32`) in `.env`, run `docker compose up -d` again and restart `npm run dev`.

## Emailed codes locally

Account recovery, email changes and two-step login send codes by email. Send them to the mail sink instead of Resend:

```dotenv
RESEND_API_URL=http://localhost:8025
RESEND_API_KEY=mail-sink
RESEND_FROM_EMAIL=Linkord <noreply@localhost>
```

Restart `npm run dev` and read the codes with `docker compose logs -f mailsink`.

## Sample data

```bash
npm run db:seed
```

Creates four accounts (`ana`, `bruno`, `carla`, `davi`; the shared password is printed at the end and set at the top of `server/src/scripts/seedDev.ts`), friendships and a pending request, two DMs, and a server ("Equipe do projeto") with `#geral`, a read-only `#avisos` fed by a webhook, a voice channel, a playground channel and a hoisted moderators role. It only runs against a database on `localhost`, and running it again leaves existing rows alone. Restart `npm run dev` afterwards: the server caches memberships in memory.

## Create an administrator

```bash
npm run admin:grant -- <your-username>
```

## The whole stack in Docker

The `full` profile of `docker-compose.yml` adds the app, built from the `Dockerfile`, to the same three services. It needs only Docker.

```bash
cp .env.full.example .env.full
```

Fill in the required values:

```dotenv
REGISTRATION_CODE=<anything; people need it to sign up>
POSTGRES_PASSWORD=<openssl rand -hex 24>
LIVEKIT_API_KEY=<openssl rand -hex 8>
LIVEKIT_API_SECRET=<openssl rand -hex 32>
```

```bash
docker compose --env-file .env.full up -d --build
```

Open [http://localhost:3000](http://localhost:3000) and register with the code.

- **`--env-file .env.full` goes on every command** (`ps`, `logs`, `exec`, `down`). The file sets `COMPOSE_PROFILES=full` (adds `app`) and `COMPOSE_PROJECT_NAME=linkord` (its own database and volumes); without it Compose acts on the development services. It is also the app's environment, so any variable from `.env.example` can go there.
- **Not at the same time as development:** both use ports 3000, 5432, 7880–7882 and 8025. `docker compose down` one before starting the other.
- **Data:** the `linkord_postgres_data` and `linkord_uploads` volumes. `down` keeps them, `down -v` deletes them.
- **Network:** the app reaches LiveKit as `http://livekit:7880` (`LIVEKIT_SERVER_URL`); browsers use `LIVEKIT_URL` (`ws://localhost:7880`). Everything is published on `127.0.0.1` only, and the image trusts `X-Forwarded-For`, so serve other machines only as [DEPLOY.md](DEPLOY.md#the-complete-stack-on-one-server) describes.
- **Emailed codes:** `docker compose --env-file .env.full logs mailsink`.
- **Administrator:** `docker compose --env-file .env.full exec app node server/dist/scripts/adminRole.js grant <username>`.
- **Updating:** `git pull` and the same `up -d --build`; migrations run at startup.
- **Backups:** see [DEPLOY.md](DEPLOY.md#backups).
- **Playground service:** add `playground` to `COMPOSE_PROFILES` and set `PLAYGROUND_URL=http://localhost:3100` and `PLAYGROUND_SECRET` (see `.env.full.example`). It builds `playground/Dockerfile` and runs it as `playground` on 3100, with its own database `playground-postgres`.

## Desktop app

`desktop/` is an Electron window that loads a Linkord server's address, so the page talks to `/api` and `/ws` on its own origin and the server's cookies, origin check and CSP apply as in a browser. It ships for Windows only; a development run also starts on a Mac (with its own title bar buttons and tray menu, without activity detection, start at login or a taskbar count). Building the installer, updates and releases are in [DEPLOY.md](DEPLOY.md#desktop-app); the rules for changing it are in [AGENTS.md](../AGENTS.md) ("Desktop").

```bash
npm install --prefix desktop   # once; Electron downloads its binary on first run
npm run dev:desktop            # with `npm run dev` running; opens http://localhost:5173
LINKORD_URL=https://chat.example.com npm run dev:desktop   # or --url=<address>
```

Plain `http` is accepted only for `localhost`, `127.0.0.1` and `[::1]`. A development run keeps its data in its own folder (`%APPDATA%\Linkord Dev`), so it runs next to an installed Linkord.

What the window does, and how to try each part:

- **Navigation and permissions.** Only the server's origin opens inside the app; other sites open in the system browser, other schemes are dropped. The page gets microphone, camera, screen capture, output device selection, notifications, image copy and fullscreen on that origin only. It sees `window.linkordDesktop` (typed in `web/src/shared/desktop.ts`) and nothing else from Node or Electron.
- **`linkord://` links** open `invite/<code>`, `channels/@me/<id>` (a DM) and `channels/<server>/<channel>`, optionally followed by a message id. Anything that does not match the strict patterns in `deepLink.ts` is ignored, and a start from a link ignores `--url`, so another program cannot pick the server. A development run registers the scheme only when started with `npm start --prefix desktop -- --register-protocol`; try a link with `start linkord://invite/<code>` in `cmd`. On the web, an invite opened in a browser on Windows offers **Abrir no app** when the server has a desktop release.
- **Title bar.** The page draws it (`TopBar` on wide screens, `DesktopFrame` elsewhere) with Windows 11's caption buttons. On a Mac, `LINKORD_TITLE_BAR=windows` shows the Windows bar.
- **Screen sharing.** Electron has no picker, so the page shows its own (`DesktopSourcePicker`) and the app grants only the chosen source to the next `getDisplayMedia`. On a Mac it needs Screen Recording permission for Electron and shares video only.
- **Notifications.** No Web Push: the page shows a native Windows toast for each new message, friend request and invitation while the app runs, with a picture it draws itself (`web/src/shared/notificationIcon.ts`), and a click opens the conversation. What the page may send is checked in `notificationLayout.ts`.
- **Tray and menu.** Closing the window hides it to the tray and keeps a call going (Settings → App can make it quit instead). The tray's right-click menu is a small window of the app's own; on a Mac, `LINKORD_TRAY_MENU=drawn` shows it instead of the native one. The menu bar (Alt) is in the system's language.
- **Settings → App** (desktop only): start with the computer, start minimized, keep running when closed, version and update check. Start at login is not offered in a development run.
- **Connection screen.** Before loading the page the app checks the server (up to 10 s per try, retried 1 to 30 s apart) and shows its own "Não foi possível conectar" screen instead of Chromium's; a page process that keeps crashing stops reloading after the fourth crash (`loadRetry.ts`). To see it: `npm start --prefix desktop -- --url=http://localhost:59999`. To see the updater window, open `desktop/assets/updater.html` in a browser and call `render(view)` with a view from `updaterScreen.ts`.

### Activity detection

While the account shares its activity, `activityWatcher.ts` asks Windows every 15 seconds what is running and which game Steam reports. Only that Steam game and the programs in `activityCatalog.ts` count; nothing else, not even a process name, leaves the computer. With several running, `activityResolve.ts` picks one (the one chosen by hand in Settings → Activity, then the foreground game, then the others), and a new pick must hold for 25 seconds before it replaces a running one. The page sends the result to the server, which names games through IGDB and stores the icons of games and apps ([INTEGRATIONS.md](INTEGRATIONS.md#steamgriddb)). Settings → Activity lists what this computer detected with those icons, read from the account's own history (`GET /api/activity/history`, hidden ones included). Timers count on the server's clock (`welcome.serverTime`), so a computer whose clock is off does not show wrong durations.

**Rich Presence.** While Discord is not running, `richPresenceServer.ts` listens on Discord's IPC pipe and answers games as Discord would; it lets go as soon as a Discord process appears. What a game sends is cut down to details, state, two pictures, party size, timestamps and at most two `https:` buttons, and the server names the application through [Discord's API](INTEGRATIONS.md#discord-application-api). To try it without a game, run any Discord RPC client (for example the `discord-rpc` npm package with an application id of your own) on Windows with Discord closed.

The server keeps the newest 20 activities per account (`activity_history`, for the profile's Activity tab) and the sessions behind the [activity widgets](#activity-widgets).

## Run the checks

```bash
npm run check
```

Runs the server and playground test typechecks, the web lint, the dependency audit, the server, playground and web tests and the production build. None of the tests needs PostgreSQL (`.env.test` supplies a placeholder `DATABASE_URL`).

- **CI** (`.github/workflows/ci.yml`) runs the same on every push to `main` and `develop` and on pull requests, unless only Markdown changed, as four jobs: server (with the playground service), web, desktop, and one for the audit, `npm run check:dead-code` and the e2e typecheck.
- **End-to-end** (`.github/workflows/e2e.yml`) runs the `features`, `restart` and `upgrade` projects in parallel on pull requests into `main`, and on demand from the Actions tab. A failed job uploads the Playwright report and traces.
- **Desktop installer** (`.github/workflows/desktop.yml`) runs only by hand; see [DEPLOY.md](DEPLOY.md#building-the-installer).
- **Audit:** `npm audit --omit=dev --audit-level=high` for the root and `web/`, so keep build-only packages (Tailwind, Vite plugins) in `devDependencies` of `web/`; the image ships only the build output.

## Scripts

Every script runs from the repository root.

| Script | What it does |
| --- | --- |
| `npm run dev` | API (`:3000`), [playground service](#playground-channels) (`:3100`) and web (`:5173`) in watch mode. |
| `npm run dev:desktop` | The [desktop app](#desktop-app) against `LINKORD_URL` (default `http://localhost:5173`). Needs `npm install --prefix desktop`. |
| `npm run package:desktop` | The Windows installer, see [DEPLOY.md](DEPLOY.md#building-the-installer). |
| `npm run build` / `npm start` | Production build of the server, the playground service and the web app, and the built server. |
| `npm run check` | Everything that should pass before pushing ([Run the checks](#run-the-checks)). |
| `npm test` | `test:server`, `test:playground` and `test:web`. |
| `npm run test:server` / `test:playground` / `test:web` / `test:desktop` | Unit tests of one side (`node --test`, `node --test`, Vitest, `node --test`). `test:desktop` needs `desktop/` installed and is not part of `npm test`. |
| `npm run test:server:coverage` | Server unit tests with Node's coverage report. |
| `npm run typecheck:server:tests` / `typecheck:playground:tests` | Typechecks `server/tests/` or `playground/tests/`. |
| `npm run test:integration` | `server/tests/integration/*.itest.ts` against a throwaway database it creates and drops on your local Postgres. |
| `npm run test:e2e` (and `:features`, `:restart`, `:upgrade`) | The browser suite ([End-to-end tests](#end-to-end-tests)). Needs Docker and Chrome. |
| `npm run check:audit` | The dependency audit, part of `npm run check`. |
| `npm run check:dead-code` | `knip`: unused files, exports and dependencies across `server/`, `web/`, `e2e/` and `desktop/` (all four installed). Runs in CI, not in `npm run check`. |
| `npm run db:migrate` | Applies pending migrations (the server also does it at boot unless `MIGRATE_ON_BOOT=0`). |
| `npm run db:generate` | Generates a migration from `server/src/db/schema.ts`. Rename the file to describe the change. |
| `npm run db:seed` | [Sample data](#sample-data). |
| `npm run db:studio` | Drizzle Studio over `DATABASE_URL`. |
| `npm run db:playground:migrate` / `db:playground:generate` | The same for the playground service's database (`PLAYGROUND_DATABASE_URL`, schema in `playground/src/db/schema.ts`); it also migrates itself when it starts. |
| `npm run db:preflight` | Read-only inventory of legacy data that would block a migration (exit 1 means blocked; `-- --json` for machine output). |
| `npm run db:repair` | Repairs the legacy relationship rows `db:preflight` reports. |
| `npm run db:rehearse` | Rehearses the migrations on throwaway local databases. |
| `npm run backup` / `restore` | Backup and restore, see [DEPLOY.md](DEPLOY.md#backups). |
| `npm run backup:rehearse` | Backup, restore and a boot on throwaway local databases ([below](#backup-scripts-locally)). |
| `npm run admin:grant -- <username>` / `admin:revoke` | Gives or takes administrator access. |
| `npm run emoji:data` | Rebuilds `web/public/emoji-data/<lang>/emojis.json` from the pinned `emojibase-data`, leaving out what the pinned `@discordapp/twemoji` cannot draw. Run it after bumping either. |
| `npm run icons` | Rebuilds `web/src/shared/ui/icons/fluent.ts` from `@fluentui/svg-icons` for every icon imported from `@/shared/ui/icons`. A new icon needs a line in `FLUENT_ICONS` (`web/scripts/buildIcons.ts`) first; a test fails while the file is stale. |

`build:server`/`build:playground`/`build:web` and `dev:server`/`dev:playground`/`dev:web` are the parts of `build` and `dev`. The packages have their own scripts, which the root ones call: `web/` (`dev`, `build`, `lint`, `preview`, `test`, `test:coverage`), `desktop/` (`start`, `build`, `typecheck`, `test`, `package`) and `e2e/` (`test`, `test:features`, `test:restart`, `test:upgrade`, `report`, `typecheck`), run with `--prefix <package>`.

The scripts behind `db:*`, `admin:*`, `backup*`, `restore` and `test:integration` live in `server/src/scripts/`, each with a header comment on how to call it.

## End-to-end tests

`e2e/` drives the real app in Chrome with several accounts at once, against a production-shaped Docker stack (`e2e/docker/compose.yml`: the app image behind Traefik, a LiveKit dev server, a throwaway in-memory Postgres and a mail sink). It is its own Compose project (`linkord-e2e`), so it never touches the dev database, but it publishes the same LiveKit ports and 8025: run `docker compose down` first.

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix e2e   # once; uses the installed Chrome
npm run test:e2e
```

- `test:e2e:features`: every feature on the working tree's build.
- `test:e2e:restart`: what a redeploy of the same build must survive.
- `test:e2e:upgrade`: tabs opened on the production version (`origin/main`, or `E2E_BASE_REF`) while the server is upgraded to the working tree. It adapts to what the base version supports and says so in the report's annotations.

Each run builds `linkord-e2e:head` from the working tree (uncommitted changes included), starts the stack, runs and removes it. `E2E_KEEP_STACK=1` leaves it up at `http://localhost:8080`, `E2E_HEADED=1` shows the browsers, `E2E_RETRIES=0` turns retries off, and `E2E_HEAD_IMAGE=<tag>` tests an image you built yourself. A failure keeps a trace, video and screenshot: `npm run report --prefix e2e` opens the report, `npx playwright show-trace <trace.zip>` (from `e2e/`) replays it.

On Node 22.18 or newer, set `NODE_OPTIONS=--no-experimental-strip-types` as CI does: Node's own TypeScript stripping rejects what Playwright compiles.

### How a spec runs

1. Global setup builds the image and starts the stack (`e2e/stack/`). Tests share it and run one at a time.
2. The `users` fixture (`e2e/fixtures/test.ts`) signs up real accounts, each in its own browser context. `users.create(prefix, { device: 'phone' })` makes it a touch phone. Chrome gets a fake camera and microphone, so calls carry real media through LiveKit.
3. Data is set up through the app's HTTP routes (`e2e/fixtures/api.ts`), never by writing to the database, which the app caches in memory.
4. The spec drives the UI by role and pt-BR label (`e2e/fixtures/app.ts`) and checks what a person would see. `waitForSocketEvent` waits for a server event in a tab, and emailed codes come from the sink (`waitForEmailCode` in `e2e/stack/stack.ts`). A Content-Security-Policy violation in any console fails the test.
5. Restart and upgrade specs change the server under the open tabs: `deploy()` recreates the app container like a redeploy (and fixes the uploads owner as [DEPLOY.md](DEPLOY.md#folders-and-permissions) asks), `stopApp()`/`startApp()` keep it down for a while.

### What is covered

| Spec | What it checks |
| --- | --- |
| `features/auth` | Sign-up with and without the code, login, logout, two-step login on and off, ending another session. |
| `features/account-data` | A data export built, emailed and downloaded; deleting the account and cancelling it by signing in. |
| `features/friends` | Requests accepted, declined and cancelled; block and unblock. |
| `features/dm` | Talking in a DM, unread counts, no DM without friendship, muting a DM across tabs. |
| `features/chat` | Send, typing, reply, edit, delete, reactions, search, image and video attachments, the new-messages line, marking as read. |
| `features/voice-messages` | Recording and playing a voice message; recording refused during a call without breaking its microphone. |
| `features/servers` | Creating, invites, permissions (`SPEAK`, hidden and read-only channels), kick, ban, deleting, an animated icon, mute levels. |
| `features/pins` | Pinning and unpinning, the `PIN_MESSAGES` permission, saved messages. |
| `features/search` | The header search's filters, sort, jump to message and history. |
| `features/voice` | Hearing each other, mute, camera, screen share, moving and disconnecting a member. |
| `features/call-membership` | A LiveKit client using a kept token is removed from the room after leaving or being banned. |
| `features/dm-call` | Decline, cancel, an answered call with audio both ways, a video call. |
| `features/call-tabs` | One call per account across two tabs, for voice channels and DM calls. |
| `features/webhooks` | Text and cards through the ingress, invalid payloads, rotating and deleting the URL, the webhook picture. |
| `features/soundboard` | Uploading and playing sounds, the `CREATE_EXPRESSIONS` permission, sounds from another server. |
| `features/emoji` | Shortcodes, server emojis across servers and DMs, uploading one, the composer on desktop and phone. |
| `features/stickers` | Uploading, sending across servers, replying to one, a deleted sticker. |
| `features/profile` | Profile edits reaching a friend, animated photo and banner, the games widgets and Wall editing, the phone layout. |
| `features/activity` | Ranked activity and the summary published on the Wall from the desktop history. |
| `features/reports-admin` | Reporting a message, the admin deleting it, suspending an account. |
| `features/settings` | Language and theme following the account to another browser; text size staying on the device. |
| `features/security` | No framing, a foreign script refused and reported, YouTube as a sandboxed iframe. |
| `features/presence` | Status and custom status reaching other devices and friends, invisible, status kept across a reload. |
| `restart/voice` | A voice call survives a redeploy, and someone joining afterwards hears the others. |
| `restart/dm-call` | An answered DM call and a ringing one survive a redeploy. |
| `restart/chat` | Messages sent during a redeploy are stored and shown exactly once. |
| `restart/voice-message` | A voice message sent while the server is down arrives once. |
| `restart/upload` | A throttled 40 MB upload survives a 10 s and a 30 s outage, byte for byte. |
| `restart/activity` | Activity reported after a redeploy does not overlap the previous session. |
| `upgrade/upgrade` | Old and new tabs exchanging messages and friend requests, and a call going on across the upgrade. |

When you add a user-facing flow, add it to the matching spec (or a new `features/<area>.spec.ts`) and to this table.

## Backup scripts locally

`npm run backup` and `npm run restore` (documented in [DEPLOY.md](DEPLOY.md#backups)) need `pg_dump`, `pg_restore` (at least as new as the server) and `tar`. On a Mac without the PostgreSQL client tools, point `PG_DUMP_BIN` and `PG_RESTORE_BIN` at wrappers that run them in the dev database container:

```sh
#!/bin/sh
# pg_dump-in-docker; the pg_restore twin is the same with pg_restore
exec docker exec -i -e PGPASSWORD -e PGUSER -e PGDATABASE -e PGHOST -e PGPORT linkord-dev-postgres-1 pg_dump "$@"
```

`npm run backup:rehearse` runs the whole path on throwaway `linkord_rehearsal_*` databases of your local Postgres: seeds data and files, takes four backups with `BACKUP_KEEP=2`, restores the last, boots the real server on it and checks a sign-in and byte-for-byte downloads, plus the restore's refusals. Run it after changing the schema or `server/src/scripts/backup/`; `-- --keep` leaves the databases for inspection.

## Server limits and background jobs

All the numbers below are in `server/src/config/env.ts`; the ones that can be set are in `.env.example`.

### Data retention

A daily sweep (`modules/retention/`, two minutes after boot, then every 24 hours) trims tables that grow with use, at most 1000 rows per statement. Each setting is in days; `0` keeps rows forever, and a value that is not a whole number stops the server at boot.

| Setting | Default | What it trims |
| --- | --- | --- |
| `AUDIT_RETENTION_DAYS` | `0` | `admin_audit_logs` |
| `DATA_REPAIRS_RETENTION_DAYS` | `0` | `data_repairs`, the only record of what a legacy repair changed |
| `NOTIFICATION_READ_RETENTION_DAYS` | `30` | notifications, by the time they were read |
| `NOTIFICATION_UNREAD_RETENTION_DAYS` | `90` | notifications never read |
| `OUTBOX_RETENTION_DAYS` | `7` | delivered `outbox_events` (failed ones stay for an administrator to see) |
| `SERVER_AUDIT_RETENTION_DAYS` | `90` | `server_audit_logs`, each server's own log |

Login sessions go when they expire (`SESSION_TTL_DAYS`, 30) or sit unused for `SESSION_IDLE_DAYS` (14; `0` turns it off), with the address and browser stored with them. Activity sessions are pruned 400 days after they were last seen. `/admin/system` shows each limit and what the last sweep deleted.

A new table with retention gets an entry in `modules/retention/retentionTargets.ts` (or calls `registerRetentionTarget`) with its own variable read through `parseRetentionDays`, a row above, a line in `.env.example` and a label under `system.retentionTables` in the admin locales.

### Upload limits

A chunked upload reserves its declared size against `MAX_STORAGE_BYTES` (30 GB) at `init`, so two uploads cannot both take the last free space. Because reserving is free, it is bounded:

- **Per account:** at most 8 open uploads (`MAX_OPEN_UPLOADS_PER_USER`), and at most `MAX_PENDING_UPLOAD_BYTES_PER_USER` (one full message of the largest files, 2 GB) not yet sent. Past either, `init` answers `409 quota_exceeded`.
- **Idle uploads** lose their reservation after 15 minutes without a chunk (`UPLOAD_IDLE_TTL_MS`); any upload goes after 24 hours (`UPLOAD_SESSION_TTL_MS`).
- **Every write** (attachments, profile images, emojis, stickers, sounds) checks the ceiling with `hasRoomFor`, which counts open reservations.

### Socket connection caps

`join` refuses a new live connection past `MAX_PARTICIPANTS` (500, the whole instance, answered with `full`), `MAX_CONNECTIONS_PER_USER` (4) or `MAX_CONNECTIONS_PER_IP` (20), both answered with `too_many_connections`. A resume (`join {id, token}`) is never refused, and a connection waiting out its reconnect grace holds no slot. The per-address cap needs `TRUST_PROXY=1` behind a proxy, or every client shares the proxy's address.

### Brute-force limits

Failed logins, wrong reset codes, code requests, username checks, wrong invite codes and sign-ups are counted in the `rate_limit_windows` table (`modules/auth/ratelimit.ts`), keyed by a SHA-256, so a restart gives nobody fresh attempts.

- **Limits:** 10 failures per account and per address in 15 minutes for logins, invite codes and reset codes; 10 code requests per address (recovery) or account (email change) in 15 minutes, and at most 5 code emails per account in 15 minutes; `REGISTRATIONS_PER_IP_PER_HOUR` sign-ups per address; 30 username checks per account per minute and 300 per day.
- **The owner gets through:** a browser the account signed in from in the last 30 days (`known_logins`) passes a blocked account counter with the right password or code. Anyone else gets the same answer as for a wrong password, so the block reveals nothing, and getting through does not clear it.
- **Fail closed:** if the database cannot answer, the attempt is refused with `503 rate_limit_unavailable`.
- **In memory on purpose:** socket flood control, link previews and game searches only cap short bursts, so losing their counts on a restart costs nothing.
- **A new limit** uses `checkBlocked` / `recordFailure` / `reset` for mistakes, or `consume` for requests counted either way, with a key namespace of its own (tests in `server/tests/integration/rateLimits.itest.ts`).

## Restarting the server during a call

Restarting `npm run dev` or deploying should leave a call running. To see it, join a voice channel with two accounts, restart `npm run dev`, and check that both stay connected without touching either tab. The rules that keep this working are in [AGENTS.md](../AGENTS.md) ("Realtime compatibility and deploys"), and the `restart` end-to-end specs check them.

## Content-Security-Policy

The server builds the policy in `server/src/http/securityHeaders.ts`; what operators see is in [DEPLOY.md](DEPLOY.md#security-headers). The Vite dev server does not send it, so to see it run the production build (`npm run build`, then `npm start` on port 3000) or the end-to-end suite.

- **Scripts** only from our origin. The inline scripts in `web/index.html` and `web/public/offline.html` are allowed by SHA-256 hashes computed at boot, so editing them needs nothing else. Inline event handlers cannot be hashed (use `addEventListener`), and `eval`, `new Function` and WebAssembly stay blocked. A library that injects a third-party script (YouTube's iframe API, for one) is not allowed: embed the provider's player as an iframe.
- **Styles:** stylesheets from our origin, and `<style>` elements only when their text matches a hash computed at boot (the offline page, the theme bootstrap, and the crop dialog's sheet in `csp-style-sources.json`). Style attributes stay allowed, since React, Motion and Base UI set them while rendering.
- **Images** from our origin and `https://*.klipy.com`; every other third-party picture goes through the [media proxy](INTEGRATIONS.md#media-proxy), unless `MEDIA_PROXY=0`. **Media** from any `https:` host. **Connections** to our origin, `LIVEKIT_URL` (any `*.livekit.cloud` host for LiveKit Cloud), the playground service's `PLAYGROUND_URL` when it is another origin, and KLIPY's API when it is configured.
- **Frames** only from the link-preview player hosts (`PLAYER_HOSTS` in `server/src/modules/link-preview/playerHosts.ts`), which the client mirrors in `web/src/features/media/linkPlayer.ts`: a new player host goes into both.

**Adding a domain:** add it to the matching directive in `buildContentSecurityPolicy` (conditional on its env variable if it has one), add a case to `server/tests/http/securityHeaders.test.ts`, and run the feature's end-to-end spec. A blocked request shows in the browser console as `… violates the following Content Security Policy directive` and in the server log as `content security policy violation`. `CSP_REPORT_ONLY=1` reports without blocking, for rolling out a riskier change.

## Playground channels

A playground is a voice channel with `voice_mode = 'playground'` (chosen when the channel is created, not changed later), one per server at most (a second is refused with `playground_exists`, and the create dialog stops offering it; servers that already had two keep them), offered only where the [playground service](DEPLOY.md#playground-service) is on. Everything a voice channel does still applies; only the call view and the audio mix differ. The code is in `web/src/features/playground/`:

- `PlaygroundLayer` + `playgroundSession.ts` live for as long as you are in the call, with or without the 3D view on screen: they keep your position, send it to the others over LiveKit's data channel (`playgroundProtocol.ts`), and set everyone's volume by distance (`proximity.ts`: full within 8 m, then a gentle fade, silent only from 72 m). Someone whose position never arrived (a tab from before protocol 31) is heard at full volume. A stream's own sound is not attenuated: the big screen is for everyone.
- The world (`game/worldGen.ts` in `playground/src/game/`, generated once by the playground service when a playground is first visited, then saved with everything its players changed) is a 128 × 128 island, 64 blocks high, laid out on purpose: the lobby in the middle (a grass plaza, the big screen's wall at its north end and a crafting table and a furnace at its south-east edge), gravel paths to a stony mountain in the north-east with a cave into it, a lake in the south-east, a dense oak forest in the south-west and meadows with scattered trees between, sandy beaches, a sea that goes on past the edge. Under the grass and dirt is stone down to bedrock, with coal, iron, gold and diamond ores the deeper the rarer, and a few winding caves. The browser draws it with plain three.js in `engine/`: 16 × 16-column chunks of the visible block faces (`voxelWorld.ts`), rebuilt only where a block or its light changed, with Pixel Perfection's tiles (`assets/pixel-perfection/`, CC BY-SA 4.0, tinted as the game tints grass, leaves and water; tiles painted in code stand in until they load, `blockTextures.ts`), cut-out leaves and glass, see-through water a little under the top of its cells, the outer sea as a plane, and the game's clouds (`engine/clouds.ts`: one 4-block slab cut from the pack's `clouds.png` in 12-block cells, only its outer faces built and drawn depth-first so no cloud shows inside another, drifting 0.6 blocks a second, darkened at night). Days pass as in the game: each world has a clock (`game/dayTime.ts`, 24000 ticks a day, 20 minutes), counted by the playground service while the world is loaded and saved with it (`clock` in `playground_worlds`; a new world starts at 7:00). `world-get` hands it over, the browser counts on at 20 ticks a second, and the service sends `playground-time` every minute against drift. The sky (`engine/sky.ts`) is Pixel Perfection's three skyboxes (`assets/pixel-perfection/sky/`, the pack's `fabricskyboxes`) laid over the game's sky colour at the pack's own hours: the day's pictures multiply it, the night's and its stars add to it, each turning slowly about the vertical; the pack's sun and the phase of its moon (one a day, of eight) cross it from east to west, and the fog takes the colour of its horizon. Licenses and credits are in [CREDITS.md](../CREDITS.md). It is lit the block game's way, after minecraft-renderer (MIT, PrismarineJS): sky light propagated through the blocks (`engine/lighting.ts`: darker under trees, in caves and under water, worked out again only around a block that changed), smooth lighting and ambient occlusion baked into each face corner, a fixed shade per face direction, and a shadow map from the moving sun that takes what it does not reach down to 60%, fading out as it sets. The shader darkens the sky light with the time of day (11 steps at night, so open ground goes from 15 to 4, a little blue), without rebuilding the terrain. People cast shadows and are lit by the sky light where they stand, darkened the same way. Water is swum the game's way (`engine/playerPhysics.ts`: slow, sinking a little, Space swims up, walking into the edge of a pool climbs out), and with the eyes under water the view closes in, blue. Until the world is there and built, a loading screen like the game's (`PlaygroundLoadingScreen.tsx`, its dark dirt background) says what is going on: connecting to the playground service, downloading the world, building its terrain (with a bar, as the chunks are built), or that the service cannot be reached or cannot open the world, while it keeps trying; nobody moves meanwhile. The 3D view (`PlaygroundStage`) is loaded on demand, since three.js is most of its weight.
- People are box models painted from a skin in the common 64×64 format (`skins/skinFormat.ts`: inner and outer layer, classic or slim arms, old 64×32 skins converted on load; `engine/blockAvatar.ts`). Without a chosen skin, an account gets one of Linkord's own, painted from its id (`skins/defaultSkins.ts`). A chosen skin is kept with the account by the playground service (`playground/src/skins.ts`, its `playground_skins` table; protocol 36), so it survives reloads and follows the account to other devices: `skin-set` on the service's socket saves your own, and `skin-get` reads your own or that of anyone connected in your call (anyone else is `not-here`, asked again a few seconds later). Everyone in the call reads each person's skin when they show up (`playgroundSession.ts`, `skins/accountSkin.ts`), keyed by account rather than by connection; without the service, everyone wears their default; a change is also sent to the others as a reliable data packet once saved, the fast path older tabs still rely on. A skin left in the browser by older versions (`ss-playground-skin`) is moved to the account on the next playground and then forgotten. Every skin, picked or received, is decoded, checked for size and re-encoded (`skins/skins.ts`) before it reaches a texture. In first person the camera shows your own arm.
- Movement and animation follow the block game's own rules, ported from minecraft-web-client and its renderer and physics packages (MIT, PrismarineJS): `engine/playerPhysics.ts` steps the local player at 20 ticks a second (walk 4.3 blocks/s, sprint 30% faster, sneak 30%, a 1.25-block jump, sprint jumps carry forward, sneaking stops at edges, one-block steps need a jump, which touch screens do by themselves) as a 0.6 × 1.8 box colliding with every block, leaves included (`IslandMap.isSolid`; the sea is a wall), and the engine draws between ticks. The block under the crosshair, within 4.5 blocks of the eyes, gets the game's thin black outline (`engine/blockTarget.ts`). `engine/bipedPose.ts` is the humanoid model's pose (limb swing from the distance walked, idle arm sway, the punch, the sneak, a body that follows the head within 50°), `engine/viewBob.ts` the first-person view and arm sway, and `FirstPersonArm` places the arm with the original's bare-hand transforms. A held item follows the game's own placement: in first person its arm transforms and the model's `firstperson_righthand` display (no mirror for the right hand), in third person `ItemInHandLayer`'s step to the fist and the `thirdperson_righthand` display of `item/handheld` (tools, sticks: held by the handle, pointing forward) or `item/generated` (anything else: held flat), with the arm raised a little as the game's `ArmPose.ITEM` does; a block keeps its own smaller placement. The view starts in first person, and V goes round first person, third person from behind and third person from the front; the third-person camera sits 4 blocks out on the line of sight and moves in before terrain (`engine/cameraCollision.ts`). Head heading, sneaking and arm swings travel in the position packet as optional fields older tabs ignore.
- Input: walking is `engine/controls.ts` (WASD, Ctrl or a double tap of W to sprint, Shift to sneak, Space, a click to swing the arm, a locked mouse or a mouse drag where the lock is refused; a joystick and a look drag on touch screens; the desktop app grants `pointerLock` to the app's origin). Every other key is decided in one place, `gameKeys.ts`, and applied by the stage in the capture phase: Esc and Tab open the menu (a held Tab does not toggle it again), T, Enter and / the chat, F1 hides the HUD, V and F5 change the camera, F and F11 toggle fullscreen, Alt lets go of the mouse without pausing (to use another window or monitor while the game goes on) and takes it back when pressed again, and what the browser would do with the rest (reload, find, zoom, save, Alt's menu bar, the right-click menu) is swallowed. The browser's own Esc letting go of the mouse with nothing open pauses into the menu, as the block game does; the window losing focus does not. Closing a screen (the inventory, a crafting table, a furnace, the chat, the menu) takes the mouse back, after Esc only once the key is up (outside fullscreen the browser also lets go of the mouse on Esc's release, which would pause into the menu); browsers allow that only shortly after a click or key press, and Esc does not count, so where it is refused the next walking key or click takes it (a refusal then never stops clicks from asking again). What is off or on (microphone, sound, the big screen) shows in the top-right corner, under the menu's button on touch screens (the only ones that need it); a blocked microphone only shows there as muted, without the call's long notice.
- What no page can stop in a normal browser tab are Ctrl+W, T and N, and the browser's Esc releasing the mouse: only fullscreen started by the page with the [Keyboard Lock API](https://developer.chrome.com/docs/capabilities/web-apis/keyboard-lock) (Chromium; holding Esc for two seconds still leaves) keeps them in the game. So while the game is fullscreen (F11 or the menu's button), those keys are locked (`KEYBOARD_LOCK_KEYS`). Outside it, or in Firefox and Safari, Ctrl+W meets the page's leave prompt. The desktop app has no Ctrl+W shortcut.
- Tab opens the game menu (`PlaygroundMenu.tsx`) that replaces the call's control bar: a centred column of block buttons, with the call's switches (microphone, sound, the big screen, the soundboard) in a dock of pixel-art slabs (`PixelIcon.tsx`, red while off, green while on the screen), then camera and fullscreen (devices are picked in the call's own controls), and two pages of its own for the skin and who is on the island (Esc goes back a page, a held Tab does not toggle it again). It shares its logic with the bar through `useCallControls`. The menu and HUD share one look (`pixelUi.ts`) and use monogram (datagoblin, CC0).
- The game chat (`PlaygroundChat.tsx`): whoever manages a playground channel links one of the server's text channels to it (Channel settings → Game chat, `playground_chat_id`, sent as `playgroundChatId` on playground channels since protocol 32). In the game, T or Enter opens it over the world with that channel's recent history, twenty lines at a time (the wheel moves seven lines, one with Shift, PageUp and PageDown a page, a thin bar shows where you are, and new messages do not pull you down while you read older ones), Enter sends and closes, Esc closes, and the arrows bring back what you sent; new messages show in the bottom-left corner for 10 seconds, as in the block game. Each message shows as the channel does (`GameChatContent.tsx`, through the chat's own `ChatMessageText`): mentions, emojis and the server's emojis, and links in blue and underlined, opening in a new tab, but with no preview cards; a sticker small under the name; pictures, videos and GIFs as small thumbnails, other files by name. Only links can be clicked (`linksOnly` on `ChatMessageText`): no media viewer, profile, emoji details or copy button, nothing that would take the player out of the game. It is the channel itself, not a copy: sends go through the same outbox as the channel's composer and need the same permissions, and its messages count as unread there as usual. Someone who cannot see the channel, or cannot post in it, is told so in the game.
- The playground service (`playground/` at the repo root) is a second Node process (in production its own container, from `playground/Dockerfile`, which installs only `playground/package.json`: a package the service starts importing goes there too, at the version the root lockfile has, which `playground/tests/dependencies.test.ts` checks; development itself runs on the root's packages) with its own PostgreSQL database (`PLAYGROUND_DATABASE_URL`), so it can restart, or fall over, without touching the app or anyone's call, and a deploy of the app no longer resets the game. It keeps no accounts: in a playground call the client asks the app for a pass (`playground-token` on the app's socket, protocol 35), which the app grants only to a connection in that playground call with `CONNECT` there, signed with `PLAYGROUND_SECRET` and valid for 90 s (`server/src/modules/playground/playgroundAccess.ts`). The client connects with it to `/playground/ws` on `PLAYGROUND_URL` (Socket.IO, websocket only; `playgroundLink.ts`) and renews it every 30 s; the service closes a connection whose pass ran out, so leaving the call or losing the channel ends its access. Anything else that goes wrong (the service restarting, the network) is retried with a fresh pass. The app answers `token: null` when the call is not a playground or the service is off. `PLAYGROUND_URL` is also the switch for playgrounds as a whole (`shownVoiceMode` and `playgroundsEnabled` in `server/src/modules/servers/serverAccess.ts`): unset, every playground channel is shown, joined and permitted as an ordinary voice channel (`voiceMode: 'standard'`, no `playgroundChatId`, no LiveKit data), creating one is refused, and `welcome.playgroundEnabled` (protocol 37) hides it from the create dialog; the row keeps `voice_mode`, so setting it again brings them back. The app also talks to the service itself, under `/playground/internal/` at `PLAYGROUND_INTERNAL_URL` (default `PLAYGROUND_URL`), each request signed with the same secret (`playground/src/internal.ts`): `forget` for accounts deleted in the app (queued in `playground_forgotten_accounts` by the deletion's own transaction) and `import-skins` for skins the app kept before the service did (its old `playground_skins` table, emptied as the service takes them). `server/src/modules/playground/playgroundSync.ts` sends both every minute and deletes a row only once the service answered 200. Deploying it is in [DEPLOY.md](DEPLOY.md#playground-service).
- Fighting (protocol 33) is decided by the playground service (`playground/src/combat.ts`), so no client can heal itself, hit harder, through a hit's immunity or from across the island. Each client in a playground also reports its own position to it (`playground-pos`, a few times a second; avatars themselves still move over LiveKit), and a punch (`playground-attack`) carries where the attacker stood: the service lands it only on someone in the same call who has reported a position within 6 blocks (the block game's own server leniency). The rules are the game's 1.8 combat: 20 health, a bare hand deals 1 (×1.5 for a critical, a hit while falling), a hit makes its target immune for 10 ticks (500 ms) in which only what a stronger hit adds counts and nothing is knocked back, the knockback pushes 0.4 away from the attacker and up, plus 0.5 along the look of a sprinting attacker, and health comes back 1 every 4 s. Whether the attacker was falling or sprinting is its client's word, like its position. At 0 the player is dead until it asks to respawn (`playground-respawn`). Everyone in the call gets `playground-hit` and `playground-health`; health lives in the service's memory by connection, kept for two minutes after it drops so a reconnect is no free heal, so a restart of the service heals everyone (one of the app changes nothing). A kill earns experience (protocol 34, `playground-xp`): the game's level curve (7 points to level 1, then 2 more per level, 5 more from 15, 9 more from 30), 7 points per level of the one killed (at most 100) and never less than 7, so the first kill reaches level 1. It is kept per account and playground through deaths, rejoins and restarts, in the service's database (`playground_experience`); the HUD shows it as the game's experience bar with the level in green. A tab from before protocol 35 still sends its fighting to the app, which ignores it, so until it reloads it can neither be hit nor hit. On the client (`playgroundCombat.ts`, `engine/playerTarget.ts`), a click punches whoever the eyes look at within 3 blocks with no block in between (each player's box grown by 0.1, as in the game), as a critical when falling (where the mouse cannot be locked, a plain click punches; on a touch screen, a tap); a sprinting punch slows the attacker to 60% and ends the sprint; the knockback the service sends is applied to the body as the game does (`applyKnockback` in `engine/playerPhysics.ts`), and the HUD counts the same regeneration in the meantime. The effects follow the game: whoever is hurt is drawn 30% red for 10 ticks (`blockAvatar.ts`), the hurt player's view tilts up to 14° away from the hit (sin(t⁴·π) over 10 ticks), a critical throws its stars out of the target for 3 ticks and every hit raises a dark heart (`engine/particles.ts`, Pixel Perfection's particle textures; the game shows damage / 2 hearts, none for a bare hand, so one always shows here). The dead fall onto their side over 20 ticks and, for the others, vanish in a puff; the death screen (`PlaygroundDeathScreen.tsx`) says who did it and offers to respawn after a second, back at the spawn point.
- The game's rules live in `playground/src/game/` (blocks, items, recipes, smelting, the inventory's clicks, mining, items on the ground, the world's layout and generator): plain TypeScript with no Node or browser imports, run by the playground service and imported by the web app as `@game/` (an alias in `web/vite.config.ts` and `web/tsconfig.app.json`; the `Dockerfile` copies the folder into the web build), so both apply the very same rules.
- Building (`playground/src/building.ts`, `worlds.ts`, `inventories.ts`), the block game's way and decided by the service: holding the left button on a block digs it, its cracks showing how far (`engine/breakOverlay.ts`), in the time its hardness and the held tool give (`game/mining.ts`: a hand takes 1.5 × the hardness in seconds where it may harvest, 5 × where the block needs a pickaxe it does not have, and then nothing drops; the right tool divides that by its speed: wood 2, stone 4, iron 6, diamond 8, gold 12). The client sends `dig-start` and, once done, `block-break`; the service checks the player is alive and within 6.5 blocks of the block (from its reported position), that it dug long enough, and either changes the block for everyone (`playground-blocks`) or tells that client what the block really is. A broken block drops its item (stone cobblestone, grass dirt, coal ore coal, diamond ore a diamond, leaves a stick one time in fifty, glass nothing) as an item on the ground (`playground-items`): every client plays the same fall from the same start (`game/drops.ts`), it turns and bobs where it rests, and it goes to whoever stands next to it first (after half a second, two for a thrown stack), flying into them; items vanish after 5 minutes. A cell dug beside or under water fills with it. A right click places the held block against the face aimed at (`block-place`: within reach, against another block, never inside anyone) or opens a crafting table or a furnace (`block-use`; a sneaking player places instead); held down it places one every 4 ticks. On a touch screen a finger held still digs and a tap places, opens or punches. Q throws one of what the hand holds, Ctrl+Q all of it, and a click outside an open screen throws what the mouse carries. Tools wear (one use per block, two per hit, a sword the other way round) and break; a weapon's damage is the game's 1.8 one (a hand 1, a diamond sword 8). Bedrock and the screen's wall never break. A death drops everything its player carried where they fell. The world (its blocks deflated, its furnaces with what is in them, the items on the ground) is kept in memory while anyone is in the call and saved to `playground_worlds` ten seconds after a change, when the last player leaves and when the service stops; a world nobody visited for two minutes is let go.
- The HUD and the inventory are the block game's, cut from Pixel Perfection's GUI sheets (`hud/gui.ts`) and drawn at its automatic GUI scale (the largest whole number that still fits 320×240 GUI pixels, up to 4): ten hearts that blink after a hit (20 ticks, 10 after a heal) and jiggle at 2 hearts or less, the hotbar (1 to 9 or the wheel pick the slot, a tap on a touch screen; Ctrl and the wheel, or a pinch, move the third-person camera instead) with the held item's name above it for a moment and a worn tool's bar, and the screens (`inventory/InventoryScreen.tsx`): the inventory on E (armour, off hand, a 2×2 crafting grid), a crafting table's 3×3 grid, and a furnace's input, fuel and output with its flame and arrow, each with the 27 slots inside and the hotbar and the game's clicks (left picks up, puts down, merges or swaps; right takes half or puts down one; Shift moves a stack where it belongs, ore and sand into a furnace, coal into its fuel, all a craft makes into the inventory; a number key swaps the hovered slot with that hotbar slot). Recipes (`game/recipes.ts`): a log makes 4 planks, two planks 4 sticks, four planks a crafting table, eight cobblestones a furnace, and the pickaxe, axe, shovel and sword in wood, stone, iron, gold and diamond, shaped or mirrored. A furnace (`game/smelting.ts`) smelts iron and gold ore into ingots, sand into glass, cobblestone into stone and logs into charcoal, 10 s each, burning coal or charcoal (8 items), wood (1.5) or sticks; it runs on the service whether or not anyone looks, its front glows while it burns, and everyone with it open sees the same. The inventory is the service's (`playground_inventories`, per account and playground): each click is an operation (`inv-op`, `game/inventory.ts`) the browser shows at once and sends with a running number, and the service's answer (`playground-inv`) says the last number it applied, so the browser shows what the service says with only the later clicks on top (`inventory/inventory.ts`). Items are named and drawn in `inventory/items.ts` and `inventory/itemIcons.ts` (a block as a little cube, anything else as its picture from the pack). What a hand holds is shown in first person in place of the bare arm and in the avatar's right hand for everyone (`engine/itemModels.ts`: a block's cube, or a picture pushed out one pixel thick; `playground-held` says what each connection holds).
- One screen, one presenter: of everyone sharing, the lowest participant id is on the screen (`screenPresenter.ts`), the share button is locked for the others, and whoever started second stops.

To try it: `npm run db:seed` adds a "Playground" channel to the sample server, its game chat linked to #geral; join it with two accounts in separate browser sessions. Fighting needs the playground service on ([Apply migrations and run the app](#apply-migrations-and-run-the-app)).

## Single-instance assumption

The server is written for one process, and [DEPLOY.md](DEPLOY.md#one-instance-only) tells operators to run one. This is the inventory for whoever decides to change that; nothing here is planned.

| State | Where | What a second instance gets wrong |
| --- | --- | --- |
| Socket.IO rooms and broadcasts | `realtime/socket.ts` (no adapter) | Events never reach sockets on the other instance |
| Presence, call participants, resume tokens | `modules/presence/participants.ts` | Lists, call tiles and resumes only know their own instance; `call_presence` is read back only at boot |
| DM call state and ring timers | `modules/calls/dmCalls.ts` | Per process; `dm_calls_active` is read only at boot |
| Presence status, idle and status expiry | `modules/presence/userStatus.ts`, `presenceStatus.ts` | Changes are announced only to that instance's sockets |
| Open activity sessions | `modules/activity/activitySessions.ts` | Each process tracks what it sees and closes interrupted rows at boot |
| Login session cache (60 s) | `modules/auth/session.ts` | A logout or ban reaches one instance's cache only |
| Server snapshot cache (roles, members, channels) | `modules/servers/serverAccess.ts` | `invalidateServer` clears one instance; the other serves stale permissions |
| Upload reservations and locks | `modules/attachments/uploadSession.ts` | Storage and per-account caps only see their own instance |
| Uploaded files and data exports | `./uploads`, `EXPORT_DIR` | On the local disk; at boot every instance requeues exports being built |
| Profile edit queue | `modules/presence/profileQueue.ts` | Two tabs on different instances can save out of order |
| Flood control, link preview quota and cache, game search cache | `realtime/floodControl.ts`, `modules/link-preview/`, `modules/games/gameSearch.ts` | Per-instance counts and caches |
| Embed backfill, retention and orphan sweep reports | `modules/messages/messageEmbeds.ts`, `modules/retention/`, `modules/attachments/orphanSweeper.ts` | Repeated work; the admin page shows whichever instance answered |

Already coordinated through Postgres: the brute-force counters, the outbox drain, the profile connection sync, IGDB request pacing, user-pair locks and the report-resolution lock.

When you add state that lives in the process, add a row.

## Profile connections and Wall

Connections (Settings → Connections) are a URL or an account on MyAnimeList, GitHub, Steam or Twitch. They are self-declared, not verified. The profile shows the account handle when available, or Steam's public display name for a SteamID without a handle. A connection with "Show on profile" off stays in its owner's settings but leaves the profile and the Wall; its widgets come back when it is shown again.

On the owner's Wall, hovering over a widget reveals its reorder and remove controls. Each game cover responds to hover independently.

To develop the widgets locally:

- GitHub needs no setup.
- MyAnimeList needs `MAL_CLIENT_ID`; Steam needs `STEAM_WEB_API_KEY`; Twitch and game search need `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`. How to get each is in [INTEGRATIONS.md](INTEGRATIONS.md).
- Steam and Twitch profiles are checked when connected; MyAnimeList and GitHub sync in the background. Snapshots refresh every 24 hours, and Twitch's live widget keeps a short cache of its own. When a widget stays empty, check the `connection-sync` logs.

API: connections at `/api/me/connections` (`PATCH /api/me/connections/:id` with `{ "showOnProfile": boolean }`), the Wall layout at `PUT /api/me/wall`, another person's Wall at `/api/users/:userId/wall`. Add `?catalog=2` to the connections and Wall routes for the activity, Steam and Twitch widgets; without it a client sees and edits only the original catalog, and saving does not drop the newer widgets.

### Games widgets

Favorite game, games I like, games in rotation and want to play are not tied to a connection (`connection_id` is null, so `profile_wall_widgets` also has `user_id`). Their data is what the owner picked, in `profile_games`, saved together with the Wall:

```json
{ "widgets": [{ "connectionId": null, "type": "igdb-liked-games" }], "games": { "liked": [{ "igdbId": 1, "name": "…", "slug": "…", "coverImageId": "…", "releaseYear": 2020 }] } }
```

A list left out of `games` is untouched; a list present replaces the stored one. Lists stay saved when their widget leaves the Wall. Without IGDB credentials the widgets still appear and the picker says search is unavailable (what the end-to-end suite sees). Search is `GET /api/games/search?q=`.

### Activity widgets

Most played and the summary (7 or 30 days, `period: 7` or `30`) and recently played come from the desktop app's reports, with no connection. Presence records one open session per account on the server's clock and checkpoints it every 30 seconds. After a crash, startup closes open rows at their last checkpoint. Games hidden in Settings → Activity are left out of every total, and turning sharing off removes these widgets from the published Wall while keeping them in the editor. Sessions are kept 400 days after they were last seen, included in the data export, and deleted with the account.

Providers' limits and failures are in [INTEGRATIONS.md](INTEGRATIONS.md#myanimelist).

## Sharing into the app (Web Share Target)

`web/public/manifest.webmanifest` declares a `share_target`, so the installed app appears in Android Chrome's share sheet (not on iOS, and not for a plain browser tab).

- The share is a `multipart/form-data` POST to `/share-target` that the service worker (`web/public/sw.js`) answers, so it needs a production build with the worker registered. The worker stores the files in Cache Storage (`linkord-share-v1`) and redirects to `/app/share?id=<id>`; nothing reaches the server yet.
- `features/share/SharePage.tsx` lets the person pick a DM or channel and hands the files and text to its composer, so the usual size and count limits apply. Unfinished shares expire after an hour. The cache name, path and expiry exist in both `sw.js` and `features/share/sharedPayload.ts`; change them together.
- To try it: serve the build over HTTPS (or `localhost`), install the app on an Android phone and share a picture. `chrome://inspect` shows the worker and its Cache Storage.

## Troubleshooting

- **Development services** (`docker compose up -d`):
  - If one is not healthy, `docker compose ps` says which and `docker compose logs <service>` why.
  - Port 5432, 7880–7882 or 8025 already in use: stop the other PostgreSQL, the full stack (`docker compose --env-file .env.full down`) or the end-to-end stack.
- **The whole stack in Docker** (add `--env-file .env.full` to each command):
  - `ps` shows which service is not healthy and `logs <service>` why. The app waits for `postgres`, `livekit` and `mailsink`.
  - `ps` lists only `postgres`, `livekit` and `mailsink` and nothing answers on 3000: `.env.full` lacks `COMPOSE_PROFILES=full` (copy the `Compose` lines from `.env.full.example`).
