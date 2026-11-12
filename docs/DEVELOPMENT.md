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

Run the checks locally before pushing. This runs the server test typecheck, the frontend lint, the dependency audit, the server and frontend tests, and the production build (which also typechecks the backend and frontend):

```bash
npm run check
```

GitHub Actions runs the same checks (`.github/workflows/ci.yml`) on every push to `main` and `develop` and on every pull request, unless only docs or Markdown changed. It splits them into three jobs: server (typecheck, test typecheck, tests), web (lint, tests, typecheck and build), and a third for the audit, `npm run check:dead-code` and the e2e typecheck. The dead-code check is not part of `npm run check` because knip needs the `e2e/` packages installed; run it yourself after installing them. A newer push to the same branch cancels the run in progress.

The [end-to-end suite](#end-to-end-tests) has its own workflow (`.github/workflows/e2e.yml`). It runs on pull requests into `main`, the release gate, with the `features`, `restart` and `upgrade` projects as parallel jobs, and can be started for any branch from the Actions tab (Run workflow, then pick a project). It is not run on every push because each project builds the app image and takes 3 to 6 minutes on a hosted runner (about 6 minutes in all, since they run side by side). A failed job uploads the Playwright report and traces as an artifact. The job sets `NODE_OPTIONS=--no-experimental-strip-types`: Node 22.18 and later strip TypeScript themselves and reject what Playwright 1.49 compiles on its own (parameter properties), so set the same if your local Node is that recent.

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
| `npm run check:dead-code` | `knip`: unused files, exports and dependencies across `server/`, `web/` and `e2e/` (needs all three installed). Runs in CI, not part of `npm run check`. |
| `npm run db:migrate` | Applies pending migrations. The server also does it on boot unless `MIGRATE_ON_BOOT=0`. |
| `npm run db:generate` | Generates a migration from changes to `server/src/db/schema.ts`. Rename the file to describe the change. |
| `npm run db:seed` | Sample data for local development, see [Sample data](#sample-data). |
| `npm run db:studio` | Drizzle Studio, a browser UI over the database in `DATABASE_URL`. |
| `npm run db:preflight` | Read-only inventory of legacy data that would block a migration (exit code 1 means blocked; `-- --json` for machine output). |
| `npm run db:repair` | Repairs the legacy relationship rows `db:preflight` reports, without creating friendships or invitations. |
| `npm run db:rehearse` | Rehearses the migrations on throwaway local databases before they run for real. |
| `npm run backup` | One backup of `DATABASE_URL` and `UPLOAD_DIR` into `BACKUP_DIR`, then rotation. See [Backup and restore](#backup-and-restore). |
| `npm run restore -- [<backup>] --confirm <database>` | Restores a backup into an empty database and uploads folder, and checks the result. |
| `npm run backup:rehearse` | Backup, restore and a boot of the app on throwaway local databases. Needs `pg_dump` and `pg_restore`. |
| `npm run admin:grant -- <username>` / `admin:revoke` | Gives or takes administrator access. |
| `npm run emoji:data` | Rebuilds `web/public/emoji-data/<lang>/emojis.json` (the emoji picker's and the composer's `:shortcode:` data) from the pinned `emojibase-data` devDependency of `web/`, leaving out the emojis (and skin tones) the pinned `@discordapp/twemoji` has no picture for. Run it after bumping either package. Twemoji's SVGs themselves are copied by the Vite build to `/assets/twemoji/<version>/` (served from `node_modules` in development), so a bump only needs `npm install` and this script. |

The scripts behind the `db:*`, `admin:*` and `test:integration` commands live in `server/src/scripts/`; each starts with a comment on what it does and how to call it.

## End-to-end tests

`e2e/` drives the real app in Chrome with several accounts at once, against a Docker stack shaped like production: the app image behind Traefik, a LiveKit dev server, a throwaway Postgres and a mail sink in place of Resend (`e2e/docker/compose.yml`). Nothing touches the dev database, and no email leaves the machine: the app's `RESEND_API_URL` points at the sink (`e2e/docker/mailsink.mjs`), and a spec reads the codes it received with `emailCount`/`waitForEmailCode` (`e2e/stack/stack.ts`).

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

The app image runs as the non-root `node` user, while the base version of the upgrade specs may still run as root. `deploy()` in `e2e/stack/stack.ts` therefore runs the `chown -R node:node /app/uploads` that [DEPLOY.md](DEPLOY.md#folders-and-permissions) asks for before an upgrade.

Each run builds `linkord-e2e:head` from the working tree (uncommitted changes included; Docker's cache keeps an unchanged tree fast), starts the stack, runs, and removes it. The base version is built once per commit and reused. `E2E_KEEP_STACK=1` leaves the stack up at `http://localhost:8080`, `E2E_HEADED=1` shows the browsers, `E2E_RETRIES=0` turns retries off, and `E2E_HEAD_IMAGE=<tag>` runs against an image you built yourself instead of the working tree (build a deliberately broken tree to check that a spec catches the regression).

The `upgrade` project adapts to what the base version can do and says so in the report's annotations: if it predates call persistence it expects old tabs to rejoin their call, if its shutdown still disconnects sockets it focuses old tabs to bring them back, and if the working tree raised `MIN_PROTOCOL_VERSION` past the base's protocol it only expects the update screen. A failure keeps a trace, video and screenshot: `npm run report --prefix e2e` opens the HTML report, and `npx playwright show-trace <trace.zip>` (from `e2e/`) replays it step by step.

### How a spec runs

1. Global setup builds the app image and starts the stack (`e2e/stack/`); every test shares it, so tests run one at a time.
2. A spec asks the `users` fixture for accounts (`e2e/fixtures/test.ts`). Each is a real sign-up in its own browser context, with its own cookies and storage, like separate people on separate machines. `users.create(prefix, { device: 'phone' })` makes that context a touch phone (390x844, `hasTouch`, `isMobile`): the app shows its compact layout, `tap()` works, and a real finger drag can be sent through the DevTools protocol (`touchDrag` in `specs/features/profile.spec.ts`). Chrome gets a fake camera and microphone, so calls carry real audio and video through LiveKit.
3. Data is set up through the app's HTTP routes (`e2e/fixtures/api.ts`: servers, invites, friend requests, channels, permissions), never by writing to the database: the app caches memberships in memory and would not see such rows until a restart.
4. The spec drives the UI by role and pt-BR label (`e2e/fixtures/app.ts`), and checks what a person would see: messages, call tiles, playing audio tracks. It can also wait for a server event to reach a tab (`waitForSocketEvent`) and read the reason of each socket disconnect. Every context of the fixture also watches its console: a Content-Security-Policy violation (Chrome logs `… violates the following Content Security Policy directive`) fails the test when it ends, so each flow is checked under the real policy.
5. Restart and upgrade specs change the server under the open tabs: `deploy()` recreates the app container (SIGTERM, then a new one, like a Dokploy redeploy), `stopApp()`/`startApp()` keep it down for a while.

### What is covered

| Spec | What it checks |
| --- | --- |
| `features/auth` | Sign-up with and without the invitation code, the login form (wrong password refused), session across reloads, logout. Two-step login turned on from Settings → Security with the emailed code, then a login that needs the next code (a wrong one refused); ending another session from the session list signs that browser out without a reload. |
| `features/friends` | Request from the form accepted in Pending, decline, cancel, block (no messages or calls) and unblock. |
| `features/dm` | Talking in a DM, the unread count until it is opened, no DM without friendship; muting a DM from its row's menu drops its count live in another tab of the account, and the header bell unmutes it. |
| `features/chat` | Messages shown once on both sides, typing indicator, reply, edit, delete, reactions, search, image attachment. The new-messages line staying in place while reading, its jump pill and Esc clearing it; mark as read from a channel row and a whole server from its rail icon, seen in a second tab and kept after a reload. |
| `features/servers` | Creating from the rail, invite link, a member with only `@everyone` inviting without any server settings to open, a voice channel without `SPEAK` keeping the member's microphone off, new channels, a channel hidden from `@everyone`, a read-only channel, kick, ban and unban, deleting the server; an animated GIF picked as the server icon, cropped on the server with all its frames; muting a server from its header menu (no badge on its icon for plain messages, one for a mention), a channel's own level over the server's from the header bell, and both read back in a second tab. |
| `features/voice` | Seeing and hearing each other, mute and camera seen by the other side, a screen share seen by the other side until it stops, leaving, a moderator moving and disconnecting a member. |
| `features/dm-call` | Decline, cancel, an answered call with audio both ways and its line in the chat, a video call. |
| `features/webhooks` | Text and cards through the ingress (token in the URL and in the header), invalid payloads, rotating and deleting the URL, permission; a webhook picture picked in the channel settings and cropped on the server. |
| `features/soundboard` | A sound uploaded to the server reaches everyone in the call; a member adds one from the call's sound picker once `@everyone` has `CREATE_EXPRESSIONS`, and is not offered it before; a sound from another server of the player's plays in the call and someone outside that server fetches it (the play's token). |
| `features/emoji` | `:shortcode:` suggestions and a full shortcode turning into its emoji; a server emoji picked from the picker in a DM with someone outside that server, who sees the picture, and typed in another server's channel; uploading and cropping one from the server's settings; the message box drawing a server emoji and a Unicode one while typing, Backspace taking each whole, typing again after select-all and delete, and the same on a touch phone. |
| `features/stickers` | Uploading an animated sticker from the server's settings with its related emoji, name and description; sending one from the composer's sticker picker into a DM with someone outside its server, who sees it at 320 px, is told it comes from a server they are not in, has none to send, and replies quoting it by name; the message reading as unavailable once the sticker is deleted. |
| `features/profile` | Display name and bio reaching a friend live, an animated GIF picked as photo and as banner and cropped on the server (frames, size and the photo's still poster), mutual friends, the games widgets on offer with no connection (the picker reports the search unavailable, as the stack has no IGDB credentials), games saved with the Wall reaching a friend in order, and widgets reordered by dragging their handle and removed with the button under it. On a touch phone: the profile filling the screen, a game cover's actions in a menu, a widget dragged by its handle with a real finger, 44px touch targets, and a colour picker that does not make iOS zoom. |
| `features/reports-admin` | Reporting a message, the admin deleting it for everyone, suspending an account. |
| `features/settings` | The account's language following it to another browser. |
| `features/security` | Another site cannot frame the app, a script from another origin is refused and the violation reaches `/api/csp-reports`, and a YouTube link opens YouTube's player as an iframe with none of their scripts in the page. |
| `features/presence` | A status and custom status set on one device reaching the account's other device and a friend live, invisible reading as offline (custom status and online friends list included), and the status kept across a reload. |
| `restart/voice` | A voice call survives a redeploy: the tab nobody touched reconnects on its own (the socket drop is a transport close, never `io server disconnect`), and someone joining after the deploy lands in the same call, with audio both ways. |
| `restart/dm-call` | An answered DM call survives a redeploy; a ring survives it and can be answered, even with the click made while the tab is still disconnected. |
| `restart/chat` | A message written while the server is down, and one sent the moment the deploy starts, are stored and shown exactly once. |
| `restart/upload` | A 40 MB upload, throttled to 1 MB/s, survives a 10 s and a 30 s outage, and the stored file is byte for byte the original (sha256). |
| `upgrade/upgrade` | Tabs opened on the production version and tabs on the working tree, after the upgrade: messages both ways, a friend request accepted in an old tab, and the voice call that was going on before the deploy. |

The `restart` specs are the guard for the deploy behaviour described in `AGENTS.md` ("Realtime compatibility and deploys"): built against a tree without the reconnect, upload or DM-answer fixes, they fail.

When you add a user-facing flow, add it to the matching spec (or a new `features/<area>.spec.ts`) and to this table.

## Backup and restore

`npm run backup` is the supported way to back up a deployment, `npm run restore` the way back. Both act only on the database and uploads folder the app is configured with (`DATABASE_URL`, `UPLOAD_DIR`); there is no option to aim them at another one.

A backup is one folder in `BACKUP_DIR` (default `./backups`, `/app/backups` in the image), named by UTC time:

```
linkord-backup-20261108T015300Z/
  database.dump     pg_dump, custom format
  uploads.tar.gz    UPLOAD_DIR without tmp/
  manifest.json     row count of every table, migrations, file counts, SHA-256 of both files
```

It is written as `<name>.partial` and renamed only when complete, so a crashed run never looks like a backup. Then everything but the newest `BACKUP_KEEP` backups is deleted. Rotation only deletes folders named exactly like the ones above that hold a `manifest.json`, so a shared folder keeps its other files, and it runs only after a new backup succeeded, so a failing disk never shrinks the history. A `.partial` folder older than a day (a crashed run) is cleaned up too.

| Setting | Default | What it does |
| --- | --- | --- |
| `BACKUP_DIR` | `<repo>/backups` | Where backups are written and read. It cannot be inside `UPLOAD_DIR` (the archive would contain every earlier backup). |
| `BACKUP_KEEP` | `7` | How many backups rotation keeps. A whole number, at least 1; anything else stops the run. |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Only for the `backup` compose service: the pause between backups. |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN` | `pg_dump`, `pg_restore` | Path of the PostgreSQL client tools. |

The tools need `pg_dump` and `pg_restore` at least as new as the database server (the Docker image installs `postgresql-client`, the latest Alpine ships) and `tar`. On a Mac without the client tools, point the variables at a wrapper that runs them in the dev database container. The connection arrives in `PG*` variables and data goes through stdin and stdout, so this works:

```sh
#!/bin/sh
# pg_dump-in-docker; the pg_restore twin is the same with pg_restore
exec docker exec -i -e PGPASSWORD -e PGUSER -e PGDATABASE -e PGHOST -e PGPORT linkord-postgres-1 pg_dump "$@"
```

### Consistency between the database and the files

The backup runs while people use the app, in this order:

1. It opens a repeatable-read transaction, reads every table's row count and the id of every file the database refers to, and exports the snapshot. `pg_dump --snapshot` dumps that same instant, so the dump, the counts and the ids always agree, however busy the chat is.
2. Only then does it archive `UPLOAD_DIR`. A file is written before the row that points at it, so every row in the dump already has its file. (The other order, files first, would miss the attachment of a message sent in between.)

What can still differ, and what happens:

- **A file deleted after the snapshot** (someone deleted a message while the archive was running): the dump has the row, the archive lacks the file. The manifest counts it (`missingFromArchive`), the backup logs a warning and the restore reports it as a warning, since the message would show a broken attachment but nothing else is lost.
- **A file uploaded after the snapshot**: it is in the archive with no row. Harmless; the orphan sweep lists it in `/admin/system` and removes it once `ORPHAN_SWEEP_DRY_RUN=0`.
- **Uploads in progress** (`UPLOAD_DIR/tmp/`, chunks of a file the person is still sending): not archived, since half a file is no use. After a restore the person picks the file again.
- **Staged files** (uploaded and waiting for the message to be sent): the `staged_attachments` rows and their files are both included, and they expire 24 hours later as usual.
- **Not in the backup:** the `.env` (database credentials, `LIVEKIT_*`, and above all the Web Push VAPID keys, without which every browser's push subscription stops working) and LiveKit itself. Keep the `.env` in your password manager or secrets store. The dump holds password hashes, sessions and every message, so treat a backup like the database itself, and encrypt it if it leaves your machine.

### Running it in Docker

The app image carries the scripts and the client tools, and the compose file mounts `./backups` into the `app` container. The container runs as `node` (uid 1000), so `./backups` and `./uploads` must be owned by `1000:1000` (see [DEPLOY.md](DEPLOY.md#folders-and-permissions)).

```bash
docker compose exec app node server/dist/scripts/backup.js
```

To schedule it, pick one:

- **Compose service** (nothing to install on the host): `docker compose --profile backup up -d backup` takes a backup at start and then every `BACKUP_INTERVAL_SECONDS`, reading `./uploads` read-only. Set `BACKUP_KEEP` and `BACKUP_INTERVAL_SECONDS` in `.env`.
- **Host cron**, which fixes the time of day: `0 3 * * * cd /srv/linkord && flock -n backups/.lock docker compose exec -T app node server/dist/scripts/backup.js >> backups/backup.log 2>&1` (`flock` stops a slow backup from overlapping the next one).

A backup on the same disk as the data does not survive that disk. Keep `./backups` on another volume (set `BACKUP_DIR`, or mount a different host path over `/app/backups`), and copy it off the machine after each run, for example from the same cron line: `rclone copy backups remote:linkord-backups`, `aws s3 sync backups s3://my-bucket/linkord`, or `rsync -a backups/ other-host:linkord-backups/`. Rotation here only prunes the local folder; set a lifecycle rule on the remote copy.

### Restoring on a new server

1. Install the app and put the `.env` in place. Point `DATABASE_URL` at a new, empty database, and make sure `UPLOAD_DIR` (`./uploads`) is empty or missing (in Docker, an empty folder owned by `1000:1000`).
2. Copy the backup folder into `BACKUP_DIR`.
3. With the app stopped, run it. The first run only says what it would do and asks for `--confirm`; the database name you type must match the one in `DATABASE_URL`:

```bash
npm run restore -- latest --confirm linkord
# in Docker:
docker compose run --rm --no-deps app node server/dist/scripts/restore.js latest --confirm linkord
```

4. Start the app. It applies no migration, because the dump already has them all; if the app is newer than the backup it applies the newer ones as on any upgrade (an older app cannot read a newer database).

`latest` can be replaced with a folder name inside `BACKUP_DIR` or a path. The restore refuses, before changing anything, when:

- the backup's checksums do not match its manifest (a damaged or modified copy);
- `--confirm` is missing or is not the target database's name;
- the database already has tables (drop and recreate it yourself if that is what you want), or the uploads folder has files (it never overwrites).

`pg_restore` runs in a single transaction and stops at the first error, so a failed restore leaves the database empty, and the uploads are extracted only after it succeeds.

Afterwards it checks the result and prints it: every table has the number of rows the backup recorded, the migrations are all there, the number of extracted files is right, and every attachment, thumbnail, sound, server emoji, sticker and staged file has its file on disk (the same comparison `/admin/system` makes). A mismatch exits with code 3. Warnings (the cases listed above) exit 0, or 3 with `--strict`. Other failures exit 1, a missing confirmation 2.

### Rehearsal

`npm run backup:rehearse` runs the whole path on throwaway `linkord_rehearsal_*` databases of the local Postgres (the one in `DATABASE_URL`, which must be local) and temp folders: seeds chat data and files, takes four backups with `BACKUP_KEEP=2`, restores the last into an empty database, then starts the real server on it and checks a sign-in and the byte-for-byte download of an attachment and an avatar. It also covers the refusals (no confirmation, a damaged backup, a non-empty target) and the deleted-file warning. Run it after changing the schema or anything in `server/src/scripts/backup/`; `-- --keep` leaves the databases and folders for inspection. The unit tests in `server/tests/scripts/backup/` need neither a database nor the PostgreSQL tools.

## Data retention

Tables that grow with use are trimmed by one daily sweep (`modules/retention/`), started two minutes after boot and then every 24 hours. Each table has its own setting, in days; `0` keeps the records forever. All of them are in `.env.example`.

| Setting | Default | What it trims |
| --- | --- | --- |
| `AUDIT_RETENTION_DAYS` | `0` (forever) | `admin_audit_logs`, by creation time |
| `DATA_REPAIRS_RETENTION_DAYS` | `0` (forever) | `data_repairs`, the log of legacy-data repairs run before a migration. It is small and is the only record of what a repair changed, so it is kept unless you set a limit |
| `NOTIFICATION_READ_RETENTION_DAYS` | `30` | notifications, by the time they were read |
| `NOTIFICATION_UNREAD_RETENTION_DAYS` | `90` | notifications never read, by creation time |
| `OUTBOX_RETENTION_DAYS` | `7` | delivered `outbox_events`, by the time they were delivered. Events that ran out of attempts stay, so an administrator can see them |
| `SERVER_AUDIT_RETENTION_DAYS` | `90` | `server_audit_logs`, each server's own audit log shown in its settings, by creation time. It is a moderation aid for the server, not instance evidence, so it expires by default |

Chat send operations (a fixed 7 days) have their own cleanup and no setting. Login sessions are deleted when they expire (`SESSION_TTL_DAYS`, default 30) or go unused for `SESSION_IDLE_DAYS` (default 14, `0` turns it off; a tab with a live socket counts as use), by an hourly sweep. The address and browser stored with each session go with it: they are kept only while the session lives and shown only to the account itself.

- **Batches:** the sweep deletes at most 1000 rows per statement, oldest first, with a short pause between statements, so a table with a large backlog is never locked for long. The first run after enabling a limit on a big table can therefore take a while; later runs only remove a day's worth.
- **Report:** `/admin/system` lists each table's limit and what the last sweep deleted (the report lives in memory, so it is empty after a restart until the next sweep). A sweep that deleted something, or failed on a table, also leaves a `retention.sweep` entry in the audit log. A table that fails is logged and does not stop the others.
- **Invalid values:** a setting that is not a whole number of days (`-1`, `1.5`, `abc`) stops the server at boot, so a typo cannot silently start or stop deleting an audit trail.
- **New tables:** a table that needs retention either gets an entry in the built-in list of `modules/retention/retentionTargets.ts` or calls `registerRetentionTarget` from there from `modules/retention/retentionTargets.ts` with a `key`, a `days()` reader backed by its own env variable, and a `deleteBatch(cutoff, limit)` that deletes at most `limit` rows older than `cutoff`. The sweep, the admin page and the audit entry pick it up with no other change. Add the variable to `config/env.ts` (through `parseRetentionDays`), to `.env.example` and to the table above, plus a label under `system.retentionTables` in the admin locales.
- **Tests:** `server/tests/modules/retention/` covers the batching and the `0` rule without a database; `server/tests/integration/retention.itest.ts` covers each table against Postgres (`npm run test:integration`).

## Restarting the server during a call

Restarting `npm run dev` (or deploying) while you are in a call should leave the call running: the clients reconnect and the server restores who was in which call. To see it, join a voice channel with two accounts, stop and start `npm run dev`, and check that both stay connected without touching either tab. The rules that keep this working are in `AGENTS.md` ("Realtime compatibility and deploys"), and the `restart` end-to-end specs check it on every run.

## Upload limits

A chunked upload (`modules/attachments/`) reserves its declared size against the instance's storage ceiling (`MAX_STORAGE_BYTES`, 30 GB) at `init`, before any byte arrives, so two uploads cannot both take the last free space. Because that reservation costs nothing to make, it is bounded:

- **Per account**, checked at `init`: at most `MAX_OPEN_UPLOADS_PER_USER` (8) open sessions, and at most `MAX_PENDING_UPLOAD_BYTES_PER_USER` not yet sent, counting the declared size of open sessions plus the account's staged files (one full message of the largest files: `MAX_ATTACHMENTS_PER_MESSAGE` × `MAX_ATTACHMENT_BYTES`, 2 GB by default). Past either, `init` answers `409 quota_exceeded`. Files already sent have no per-account quota.
- **Idle sessions**: a session that receives no chunk for `UPLOAD_IDLE_TTL_MS` (15 minutes) loses its reservation and its chunks. A chunk counts from its first byte, so a slow link is not cut off mid-chunk. `init` drops idle sessions before it counts, and the sweep (at boot and hourly) does the same from the files' modification times, which is also how the reservations come back after a restart. Any session still goes after `UPLOAD_SESSION_TTL_MS` (24 hours).
- **Every path that writes a file** (attachment `complete`, profile images, emojis, stickers, sounds) checks the ceiling with `hasRoomFor` (`attachmentQuota.ts`), which counts the open reservations, so none of them can spend space promised to an upload in progress.

All of these limits are constants in `config/env.ts`; tests are in `server/tests/modules/attachments/uploadReservations.test.ts` and `server/tests/integration/attachmentUploads.itest.ts`.

## Brute-force limits

Failed logins (per account and per address), wrong password-reset codes (per account and per address), recovery and email-change code requests, username availability checks, wrong invite codes and sign-ups per address are counted in the `rate_limit_windows` table (`modules/auth/ratelimit.ts`), so a restart or a deploy does not give anyone fresh attempts and several instances would share one count.

- **Shape:** one row per key and fixed window (`count`, `window_ends_at`, `blocked_until`). A hit is a single atomic upsert; when the window is over the row is reset in place by the next hit. The key is stored as a SHA-256, so the table never holds an email, a username or an address.
- **Limits:** 10 failures per key in 15 minutes for logins and invite codes, 10 wrong codes per account and per address in 15 minutes for password reset (a resend does not restore them; an unknown username or email gets a key too, so a block never reveals whether an account exists), 10 requests per key in 15 minutes for recovery and email-change codes (recovery also sends at most 5 codes per account in 15 minutes, however the account was named, with the same response when it is over), `REGISTRATIONS_PER_IP_PER_HOUR` sign-ups per address per hour, 30 username availability checks per account per minute and 300 per day (only well-formed names are counted; renaming itself is behind the current password and its attempt counter). Account-deletion codes share the 5-per-15-minutes cap of the other code emails, and wrong ones count against the same per-account counter as login codes. The per-code attempt ceiling (`AUTH_CODE_MAX_ATTEMPTS`) already lives in `auth_codes`.
- **Cleanup:** `sweepExpiredRateLimits` runs every 15 minutes from `app/bootstrap.ts` and deletes rows whose window is over.
- **Fail closed:** if the database cannot answer, the attempt is refused with `503 rate_limit_unavailable` (and `Retry-After`) instead of being let through. A correct password clears only the account's counter, never the address's (that one expires with its window, otherwise anyone with one valid account could reset their address between rounds of password spraying); clearing is best effort, so a database hiccup there does not turn a valid login into an error.
- **Not here, on purpose:** socket flood control (`realtime/floodControl.ts`), link previews, game searches and similar per-minute quotas stay in memory. They only cap short bursts of legitimate traffic, losing them on a restart costs nothing, and a database write per socket event would be the expensive part.
- **New brute-force limit** (for example the 2FA code of LINKORD-35): use `checkBlocked` / `recordFailure` / `reset` for mistakes, or `consume` for requests that are counted whether they succeed or not, with a key namespace of its own. Tests are in `server/tests/integration/rateLimits.itest.ts`.

## Content-Security-Policy

The server sends a Content-Security-Policy with every response it serves, built in [`server/src/http/securityHeaders.ts`](../server/src/http/securityHeaders.ts) from `.env` (`APP_URL`, `LIVEKIT_URL`, `KLIPY_API_KEY`). It is the second barrier if user content (messages, names, previews) ever slips past escaping, and with `frame-ancestors 'none'` and `X-Frame-Options: DENY` no other site can put Linkord in a frame. Behind HTTPS it also sends `Strict-Transport-Security` (one year, without `includeSubDomains`).

- **Scripts** run only from our own origin. The two small inline scripts in `web/index.html` and the one in `web/public/offline.html` are allowed by their SHA-256, computed at boot from the built files, so editing them needs nothing else. Inline event handlers (`onclick="…"`) cannot be hashed: use `addEventListener`. `eval`, `new Function` and WebAssembly stay blocked (images are cropped on the server, with sharp). A library that loads a third-party script into the page (YouTube's iframe API, for one) is not allowed: embed the provider's player as an iframe instead.
- **Styles.** Stylesheets load from our own origin. A `<style>` element is allowed only when its text matches a SHA-256 computed at boot, the same way as the scripts: the offline page's sheet, the theme bootstrap's three `html,body{background:…}` rules (one per color theme, read from the built `index.html`), and the crop dialog's sheet (`csp-style-sources.json`, written by the web build from the string react-easy-crop injects). `style-src-elem` has no `'unsafe-inline'`, so an injected sheet that matches none of those is refused. Style attributes stay allowed (`style-src-attr 'unsafe-inline'`): React, Motion and Base UI set them while rendering and the text is not stable enough to hash. `style-src` itself is only `'self'`. It is the fallback for a browser that ignores the split, and every browser that can render the theme already understands it.
- **Images and media** load from any `https:` host (plus `http:` when `APP_URL` itself is http). The Wall's covers and avatars, link preview pictures and YouTube thumbnails come from our own [media proxy](INTEGRATIONS.md#media-proxy), but GIFs (KLIPY's terms), direct image and video links pasted in chat, webhook embed images and the redirects of `MEDIA_PROXY=0` still load from their own hosts.
- **Connections** go to our own origin and websocket, to `LIVEKIT_URL` over both ws and http (any `*.livekit.cloud` host for LiveKit Cloud, which hands out regional URLs), and to `https://api.klipy.com` when `KLIPY_API_KEY` is set.
- **Frames:** only the YouTube and Twitch players (`frame-src`).
- `/api/*` responses get `default-src 'none'; frame-ancestors 'none'`: JSON loads nothing.

The Vite dev server (`npm run dev`, port 5173) does not send the policy, since it serves the page itself with its own inline scripts. To see the policy in action, build and run the production server (`npm run build`, then `npm start` on port 3000) or run the end-to-end suite, which uses the production image.

**Adding a domain.** When a feature needs the browser to reach a new host, add it to the matching directive in `buildContentSecurityPolicy` (a constant next to `EMBED_FRAMES` or `KLIPY_API`, made conditional on its env variable if it has one), add a case to `server/tests/http/securityHeaders.test.ts`, and run the feature's end-to-end spec: a blocked request shows up in the browser console as `… violates the following Content Security Policy directive` and in the server log as `content security policy violation`.

**Reports and trying out a change.** Browsers post violations to `POST /api/csp-reports`: Firefox and Safari through `report-uri`, Chrome through the Reporting API (`report-to` and the `Reporting-Endpoints` header, batched about a minute) when `APP_URL` is https. Over plain http Chrome ignores `Reporting-Endpoints` and, if the policy named `report-to`, would send nothing at all, so there the policy only has `report-uri`. The server logs each one at `warn` without URL queries, at most 30 a minute per address. To roll out a riskier change, set `CSP_REPORT_ONLY=1`: the same policy is sent as `Content-Security-Policy-Report-Only`, so nothing is blocked and every violation is reported. Remove it once the log stays quiet.

## Single-instance assumption

The server is written for **one process**. Running two behind a load balancer is unsupported and breaks things quietly, so [DEPLOY.md](DEPLOY.md#one-instance-only) tells operators not to. This section is the inventory for whoever decides to change that; nothing here is planned work.

What lives in the memory (or on the local disk) of the process, and what a second instance would get wrong:

| State | Where | What goes wrong with two instances | What it would need |
| --- | --- | --- | --- |
| Socket.IO rooms and broadcasts | `realtime/socket.ts` (no adapter) | An event emitted on one instance never reaches the sockets connected to the other | A shared adapter (Redis or Postgres) and sticky sessions for the transport upgrade |
| Presence, call participants, resume tokens, restored ghosts | `modules/presence/participants.ts` | "Online" lists, call tiles and `join {id, token}` resumes only know the sockets of their own instance. Call membership is persisted for restarts (`call_presence`), but it is read back only at boot by `restoreCalls` | Presence and participants in shared storage, and `restoreCalls` made aware of which instance owns a connection |
| DM call state machine and ring timers | `modules/calls/dmCalls.ts` | The timers and the live state are per process; `dm_calls_active` is only read at boot | The state machine driven from shared storage, with the timeout owned by one instance |
| Socket flood control | `realtime/floodControl.ts` | Per-instance windows. Kept in memory on purpose: it only caps short bursts, and a restart forgetting them costs nothing | Shared counters |
| Link preview rate limit, cache and in-flight requests | `modules/link-preview/linkPreview.ts` | Per-instance quota, and the same URL is fetched once per instance | Shared counters; the cache can stay per instance |
| Login session cache (60 s) | `modules/auth/session.ts` | A logout, ban or profile save invalidates the cache of one instance only; the other keeps the old session for up to 60 s | Invalidation broadcast to every instance, or no cache |
| Server snapshot cache (roles, members, channels, overwrites) | `modules/servers/serverAccess.ts` | `invalidateServer` clears one instance. The others keep serving stale permissions until they restart | Invalidation broadcast, or a version check on each read |
| Game search cache | `modules/games/gameSearch.ts` | Harmless: only a cache. The IGDB request pacing already goes through a Postgres slot (`igdbLimiter.ts`) | Nothing |
| Upload reservations and the init lock | `modules/attachments/uploadSession.ts` (`pendingUploads`, `withInitLock`, `completingUploads`) | The storage ceiling check, the per-account upload caps and the "one complete per upload" guard only see their own instance | Reservations in Postgres, and a database lock in place of the in-memory one |
| Uploaded files and chunks | `./uploads` on the local disk | An instance cannot read what the other stored. The orphan sweep also compares one disk with one database | A shared volume or object storage |
| Data export files | `EXPORT_DIR` (`modules/data-export/`) | The job claims queued exports with `skip locked`, but the ZIP lands on the disk of the instance that built it, and at boot each instance queues again every export marked as being built | A shared volume, and a lease on the `running` rows instead of the boot reset |
| Presence status, automatic idle and custom status expiry | `modules/presence/userStatus.ts`, `presenceStatus.ts` | The chosen status is saved on the account, but the copy in memory, the per-connection idle flags and the expiry timer are per process: a change made on one instance is announced only to the sockets of that instance | Status changes broadcast to every instance, and the expiry owned by one of them |
| Profile edit serialization | `modules/presence/profileQueue.ts` | Two tabs of one account on different instances can patch the profile out of order | A per-account database lock |
| Embed backfill guard, retention and orphan sweep reports | `modules/messages/messageEmbeds.ts`, `modules/retention/`, `modules/attachments/orphanSweeper.ts` | A repeated backfill is wasted work; the admin page shows the report of whichever instance answered | Optional: an advisory lock, and reports stored in the database |

Already safe with several instances, because they coordinate through Postgres: the brute-force counters (failed logins, recovery and email-change requests, wrong invite codes, sign-ups per address; see below), the outbox drain (rows are claimed with `skip locked` and a lease), the profile connection sync, the IGDB request pacing, user-pair locks, and the report-resolution advisory lock.

When you add state that lives in the process, add a row to the table above.

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

## Sharing into the app (Web Share Target)

`web/public/manifest.webmanifest` declares a `share_target`, so the installed app shows up in Android Chrome's share sheet. iOS Safari does not support it, and neither does a plain browser tab: only an installed app is offered.

- The share is a `multipart/form-data` POST to `/share-target` (fields `title`, `text`, `url`, `files`). The page never sees it: `web/public/sw.js` answers it, so it has to be a production build with the worker registered (`import.meta.env.PROD`; `npm run build` and start the server). Without the worker the POST reaches the server and gets its 404.
- The worker stores the files and a `meta` entry under `/share-target/<id>/` in Cache Storage (`linkord-share-v1`) and redirects with a 303 to `/app/share?id=<id>`, or to `?failed=1` if it could not store them (quota, unreadable body). Nothing is sent to the server at that point.
- `features/share/SharePage.tsx` reads the entry back, lists the DMs and text channels where the account may send (and attach, when files came along), and on a pick hands the files and text to that conversation's composer (`features/chat/pendingShare.ts`). The composer adds them through its own `addFiles`, so the size limit, the attachment count and the upload are the ones a drop uses.
- The stored copy is deleted when a conversation is picked or the page is cancelled. A share nobody finished expires after an hour: the worker sweeps on activation and on every new share, and the app sweeps on start (`sweepExpiredShares`). The cache name, path and time limit exist in both `sw.js` and `features/share/sharedPayload.ts`; change them together.
- To try it: serve the build over HTTPS (or `localhost`), install the app on an Android phone, and share a picture from the gallery. `chrome://inspect` shows the worker, and Application → Cache storage shows `linkord-share-v1` while a share is pending.
- Tests: the worker's side is in `web/tests/app/serviceWorker.test.ts` (the worker source runs against a fake Cache Storage), the picker in `web/tests/features/share/`, and the composer hand-off in `web/tests/features/chat/MessageComposerShare.test.tsx`.

## Troubleshooting

- If the database is not ready, check `docker compose -f docker-compose.dev.yml ps` and `docker compose -f docker-compose.dev.yml logs postgres`.
- If port `5432` is already in use, stop the other PostgreSQL service or change the host-side port mapping in `docker-compose.dev.yml` and update `DATABASE_URL` to match.
- If the app cannot connect to PostgreSQL, confirm the container is healthy and that `DATABASE_URL` uses `localhost:5432`, the `linkord` database, and the local credentials above.
