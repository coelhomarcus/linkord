# Local development

Run the frontend and backend on your machine. PostgreSQL is required, and LiveKit and the mail sink are useful when testing calls or email.

## Prerequisites

- Bun 1.4.5 for the server, web app and browser tests
- Node.js 22 and npm for desktop development and packaging
- Docker for running local dependencies in containers. The browser tests also need the Compose plugin.

## Set up the repository

The root package, web app and browser tests each have a Bun lockfile.

```bash
bun install --frozen-lockfile
bun install --frozen-lockfile --cwd web
cp .env.example .env
```

Set `REGISTRATION_CODE` in `.env` to the code you will use to sign up. The commands below use the following local service settings.

```dotenv
DATABASE_URL=postgres://linkord:linkord@localhost:5432/linkord
DATABASE_SSL=0
COOKIE_SECURE=0
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

The server reads the optional root `.env` with literal values. Shell environment variables take precedence. Unit tests load `.env.test` explicitly.

The `LIVEKIT_*` values are only needed for calls ([Voice and video locally](#voice-and-video-locally)).

## Start the services

Start PostgreSQL once. The data is stored in the `linkord-dev_postgres_data` volume. If you already use PostgreSQL locally, point `DATABASE_URL` at your own Linkord database instead.

```bash
docker run -d --name linkord-dev-postgres --restart unless-stopped \
  -e POSTGRES_USER=linkord -e POSTGRES_PASSWORD=linkord -e POSTGRES_DB=linkord \
  -p 127.0.0.1:5432:5432 -v linkord-dev_postgres_data:/var/lib/postgresql/data \
  postgres:17-alpine
docker exec linkord-dev-postgres pg_isready -h 127.0.0.1 -U linkord -d linkord
```

Repeat the readiness check until it accepts connections. If you previously used the bundled development stack, stop its database container before starting this one. The default development volume is reused with its existing credentials.

## Apply migrations and run the app

```bash
bun run db:migrate
bun run dev
```

Vite serves the web app at [http://localhost:5173](http://localhost:5173) and Fastify the API at [http://localhost:3000](http://localhost:3000).

Stop any local dependency with `docker stop <container-name>` and resume it with `docker start <container-name>`. PostgreSQL data stays in its named volume.

## Voice and video locally

Start the LiveKit development server with the `devkey` and `secret` values above:

```bash
docker run -d --name linkord-dev-livekit --restart unless-stopped \
  -p 127.0.0.1:7880:7880 -p 127.0.0.1:7881:7881 -p 127.0.0.1:7882:7882/udp \
  livekit/livekit-server:v1.13.11 --dev --bind 0.0.0.0 --node-ip 127.0.0.1
```

Browsers on this machine connect to `ws://localhost:7880` and receive media on ports 7881 and 7882. A call needs two accounts in separate browser sessions (a normal and a private window, or [Sample data](#sample-data)). You can also point the `LIVEKIT_*` values at a service you already have.

## Emailed codes locally

Start the development mail sink from the repository root.

```bash
docker run -d --name linkord-dev-mailsink --restart unless-stopped \
  -p 127.0.0.1:8025:8025 -v "$PWD/docker/mailsink.mjs:/mailsink.mjs:ro" \
  oven/bun:1.4.5-alpine bun --no-env-file /mailsink.mjs
```

Use these settings in `.env` for account recovery, email changes and two-step login.

```dotenv
RESEND_API_URL=http://localhost:8025
RESEND_API_KEY=mail-sink
RESEND_FROM_EMAIL=Linkord <noreply@localhost>
```

Restart `bun run dev` and read the codes with `docker logs -f linkord-dev-mailsink`.

## Sample data

```bash
bun run db:seed
```

Creates four accounts (`ana`, `bruno`, `carla`, `davi`; the shared password is printed at the end and set at the top of `server/src/scripts/seedDev.ts`), friendships and a pending request, two DMs, and a server ("Equipe do projeto") with `#geral`, a read-only `#avisos` fed by a webhook, a voice channel and a hoisted moderators role. It only runs against a database on `localhost`, and running it again leaves existing rows alone. Restart `bun run dev` afterwards: the server caches memberships in memory.

## Create an administrator

```bash
bun run admin:grant <your-username>
```

## Desktop app

`desktop/` is an Electron window that loads a Linkord server's address, so the page talks to `/api` and `/ws` on its own origin and the server's cookies, origin check and CSP apply as in a browser. It ships for Windows only; a development run also starts on a Mac (with its own title bar buttons and tray menu, without activity detection, start at login or a taskbar count). Building the installer, updates and releases are in [DEPLOY.md](DEPLOY.md#desktop-app); the rules for changing it are in [AGENTS.md](../AGENTS.md) ("Desktop").

```bash
npm install --prefix desktop   # once; Electron downloads its binary on first run
bun run dev:desktop            # with `bun run dev` running; opens http://localhost:5173
LINKORD_URL=https://chat.example.com bun run dev:desktop   # or --url=<address>
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
bun run check
```

Runs the server test typecheck, the web lint, the dependency audit, the server and web tests and the production build. None of the tests needs PostgreSQL (`.env.test` supplies a placeholder `DATABASE_URL`).

- **CI** (`.github/workflows/ci.yml`) runs the same on every push to `main` and `develop` and on pull requests, unless only Markdown changed, as four jobs: server, web, desktop, and one for the audit, `bun run check:dead-code` and the e2e typecheck.
- **End-to-end** (`.github/workflows/e2e.yml`) runs the `features`, `restart` and `upgrade` projects in parallel on pull requests into `main`, and on demand from the Actions tab. A failed job uploads the Playwright report and traces.
- **Desktop installer** (`.github/workflows/desktop.yml`) runs only by hand; see [DEPLOY.md](DEPLOY.md#building-the-installer).
- **Audit:** `bun audit --prod --audit-level=high` for the root and `web/`, so keep build-only packages (Tailwind, Vite plugins) in `devDependencies` of `web/`; the image ships only the build output.

## Scripts

Every script runs from the repository root.

| Script | What it does |
| --- | --- |
| `bun run dev` | API (`:3000`) and web (`:5173`) in watch mode. |
| `bun run dev:desktop` | The [desktop app](#desktop-app) against `LINKORD_URL` (default `http://localhost:5173`). Needs `npm install --prefix desktop`. |
| `bun run package:desktop` | The Windows installer, see [DEPLOY.md](DEPLOY.md#building-the-installer). |
| `bun run build` / `bun run start` | Production build of the server and the web app, and the built server. |
| `bun run check` | Everything that should pass before pushing ([Run the checks](#run-the-checks)). |
| `bun run test` | `test:server` and `test:web`. |
| `bun run test:server` / `test:web` / `test:desktop` | Unit tests of one side (`bun test`, Vitest, `node --test`). `test:desktop` needs `desktop/` installed and is not part of `bun run test`. |
| `bun run test:server:coverage` | Server unit tests with Bun's coverage report. |
| `bun run typecheck:server:tests` | Typechecks `server/tests/`. |
| `bun run test:integration` | `server/tests/integration/*.itest.ts` against a throwaway database it creates and drops on your local Postgres. `bun run test:integration <name>` runs only the files whose name contains it. |
| `bun run test:e2e` (and `:features`, `:restart`, `:upgrade`) | The browser suite ([End-to-end tests](#end-to-end-tests)). Needs Docker and Chrome. |
| `bun run check:audit` | The dependency audit, part of `bun run check`. |
| `bun run check:dead-code` | `knip`: unused files, exports and dependencies across `server/`, `web/`, `e2e/` and `desktop/` (all four installed). Runs in CI, not in `bun run check`. |
| `bun run db:migrate` | Applies pending migrations (the server also does it at boot unless `MIGRATE_ON_BOOT=0`). |
| `bun run db:generate` | Generates a migration from `server/src/db/schema.ts`. Rename the file to describe the change. |
| `bun run db:seed` | [Sample data](#sample-data). |
| `bun run db:studio` | Drizzle Studio over `DATABASE_URL`. |
| `bun run db:preflight` | Read-only inventory of legacy data that would block a migration (exit 1 means blocked; `--json` for machine output). |
| `bun run db:repair` | Repairs the legacy relationship rows `db:preflight` reports. |
| `bun run db:rehearse` | Rehearses the migrations on throwaway local databases. |
| `bun run backup` / `restore` | Backup and restore, see [DEPLOY.md](DEPLOY.md#backups). |
| `bun run backup:rehearse` | Backup, restore and a boot on throwaway local databases ([below](#backup-scripts-locally)). |
| `bun run admin:grant -- <username>` / `admin:revoke` | Gives or takes administrator access. |
| `bun run emoji:data` | Rebuilds `web/public/emoji-data/<lang>/emojis.json` from the pinned `emojibase-data`, leaving out what the pinned `@discordapp/twemoji` cannot draw. Run it after bumping either. |
| `bun run icons` | Rebuilds `web/src/shared/ui/icons/fluent.ts` from `@fluentui/svg-icons` for every icon imported from `@/shared/ui/icons`. A new icon needs a line in `FLUENT_ICONS` (`web/scripts/buildIcons.ts`) first; a test fails while the file is stale. |

`build:server`/`build:web` and `dev:server`/`dev:web` are the parts of `build` and `dev`. The root calls scripts in `web/` (`dev`, `build`, `lint`, `preview`, `test`, `test:coverage`), `desktop/` (`start`, `build`, `typecheck`, `test`, `package`) and `e2e/` (`test`, `test:features`, `test:restart`, `test:upgrade`, `report`, `typecheck`). Run web and E2E scripts with `bun run --cwd <package> <script>`, and desktop scripts with `npm run <script> --prefix desktop`.

The scripts behind `db:*`, `admin:*`, `backup*`, `restore` and `test:integration` live in `server/src/scripts/`, each with a header comment on how to call it.

## End-to-end tests

`e2e/` drives the real app in Chrome with several accounts at once, against a production-shaped Docker stack (`e2e/docker/compose.yml`: the app image behind Traefik, a LiveKit dev server, a throwaway in-memory Postgres and a mail sink). The standard test stack uses its own disposable database. Stop `linkord-dev-livekit` and `linkord-dev-mailsink` before the standard tests if they are running, since those ports overlap. The split deploy test uses separate ports.

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 bun install --frozen-lockfile --cwd e2e   # once; uses the installed Chrome
bun run test:e2e
```

- `test:e2e:features`: every feature on the working tree's build.
- `test:e2e:restart`: what a redeploy of the same build must survive.
- `bun run --cwd e2e test:split` checks routing, cache headers and a call through a frontend-only deploy.
- `test:e2e:upgrade`: tabs opened on the production version (`origin/main`, or `E2E_BASE_REF`) while the server is upgraded to the working tree. It adapts to what the base version supports and says so in the report's annotations.

Each run builds `linkord-e2e:head` from the working tree (uncommitted changes included), starts the stack, runs and removes it. `E2E_KEEP_STACK=1` leaves it up at `http://localhost:8080`, `E2E_HEADED=1` shows the browsers, `E2E_RETRIES=0` turns retries off, and `E2E_HEAD_IMAGE=<tag>` tests an image you built yourself. A failure keeps a trace, video and screenshot: `bun run --cwd e2e report` opens the report, `bun --bun playwright show-trace <trace.zip>` (from `e2e/`) replays it.

Playwright runs on Bun and uses the installed Google Chrome. Its CLI scripts use `bun --bun` to select the runtime.

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

`bun run backup` and `bun run restore` (documented in [DEPLOY.md](DEPLOY.md#backups)) need `pg_dump`, `pg_restore` (at least as new as the server) and `tar`. On a Mac without the PostgreSQL client tools, point `PG_DUMP_BIN` and `PG_RESTORE_BIN` at wrappers that run them in the dev database container:

```sh
#!/bin/sh
# pg_dump-in-docker; the pg_restore twin is the same with pg_restore
exec docker exec -i -e PGPASSWORD -e PGUSER -e PGDATABASE -e PGHOST -e PGPORT linkord-dev-postgres-1 pg_dump "$@"
```

`bun run backup:rehearse` runs the whole path on throwaway `linkord_rehearsal_*` databases of your local Postgres: seeds data and files, takes four backups with `BACKUP_KEEP=2`, restores the last, boots the real server on it and checks a sign-in and byte-for-byte downloads, plus the restore's refusals. Run it after changing the schema or `server/src/scripts/backup/`; `--keep` leaves the databases for inspection.

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

Restarting `bun run dev` or deploying should leave a call running. To see it, join a voice channel with two accounts, restart `bun run dev`, and check that both stay connected without touching either tab. The rules that keep this working are in [AGENTS.md](../AGENTS.md) ("Realtime compatibility and deploys"), and the `restart` end-to-end specs check them.

## Content-Security-Policy

The page policy lives in `server/src/http/pageSecurityPolicy.ts`. Fastify uses it at startup when serving the monolith. In the split deploy, `docker/web/generate-headers.ts` uses it when building the Nginx image. To see the policy, run the production build (`bun run build`, then `bun run start` on port 3000) or the end-to-end suite. The Vite dev server serves without this policy.

- **Scripts** only from our origin. The SHA-256 hashes are computed from the built versions of `web/index.html` and `web/public/offline.html`. Inline event handlers cannot be hashed (use `addEventListener`), and `eval`, `new Function` and WebAssembly stay blocked. Embed a provider's player as an iframe to avoid loading its third-party script.
- **Styles:** stylesheets from our origin, and `<style>` elements only when their text matches a hash from the build (the offline page, the theme bootstrap, and the crop dialog's sheet in `csp-style-sources.json`). Style attributes stay allowed, since React, Motion and Base UI set them while rendering.
- **Images** from our origin and `https://*.klipy.com`; every other third-party picture goes through the [media proxy](INTEGRATIONS.md#media-proxy), unless `MEDIA_PROXY=0`. **Media** from any `https:` host. **Connections** to our origin, `LIVEKIT_URL` (any `*.livekit.cloud` host for LiveKit Cloud), and KLIPY's API when it is configured.
- **Frames** only from the link-preview player hosts (`PLAYER_HOSTS` in `server/src/modules/link-preview/playerHosts.ts`), which the client mirrors in `web/src/features/media/linkPlayer.ts`: a new player host goes into both.

**Adding a domain:** add it to the matching directive in `buildContentSecurityPolicy` (conditional on its env variable if it has one), add a case to `server/tests/http/securityHeaders.test.ts`, and run the feature's end-to-end spec. A blocked request shows in the browser console as `… violates the following Content Security Policy directive` and in the server log as `content security policy violation`. `CSP_REPORT_ONLY=1` reports without blocking, for rolling out a riskier change.

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

- Use `docker ps -a` to see which containers are running and `docker logs <container-name>` to investigate startup failures.
- If port 5432, 7880–7882 or 8025 is already in use, check for another local service or a running end-to-end stack.
