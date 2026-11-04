<p align="center">
  <img src="web/public/logo.svg" alt="Linkord" width="120" />
</p>

<h1 align="center">Linkord</h1>

<p align="center">
  Self-hosted real-time communication: friends, servers and calls.
</p>

<p align="center">
  <a href="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml">
    <img src="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml/badge.svg" alt="CI" />
  </a>
</p>

## What it is

Linkord is a self-hosted chat and calling platform in the style of Discord. Each account adds friends by exact `@username`, talks to them in DMs, and joins or creates **servers**: private spaces with text and voice channels, roles and invites. There is no public server directory: you get into a server by an invitation from a friend or an invite link.

- **Friends**: friend requests, accept/decline, blocking
- **Servers**: created from a template (a `#geral` text channel and a "Geral" voice channel), with categories, text and voice channels, roles with permissions (per channel too, so channels can be private), invitations to friends and invite links, kicks and bans
- **DMs**: one-to-one conversations and calls with friends
- **Chat**: attachments (chunked uploads, up to 2GB), automatic embeds (YouTube/Twitch/direct media/Open Graph), reactions, replies, edit/delete messages, search
- **Calls**: voice, camera and screen sharing in voice channels and DMs (LiveKit), with a soundboard per server
- **Webhooks**: outside systems post into a channel ([docs/WEBHOOK.md](docs/WEBHOOK.md))
- **Administration** (`/admin`): users, servers, webhooks, reports, audit log and orphaned file cleanup
- **Settings**: profile, account/security, audio/video devices, notifications, preferences, privacy (blocked users)

## Stack

- **Frontend**: React + TypeScript + Vite, Tailwind
- **Backend**: Node.js + TypeScript (ESM) with Fastify + Socket.IO
- **Database**: PostgreSQL via Drizzle ORM
- **Video/audio**: LiveKit Cloud (WebRTC)

## Running locally

Requires Node.js 22+ and a reachable Postgres (`DATABASE_URL`). For a local Postgres via Docker, with no external dependencies:

```bash
docker compose -f docker-compose.dev.yml up -d   # Postgres only, isolated from production
```

This starts on `localhost:5432` with user/password/database `linkord`/`linkord`/`linkord`, which matches the example `DATABASE_URL` in `.env.example`.

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, LIVEKIT_*, REGISTRATION_CODE, etc.
npm run db:migrate
npm run dev             # server (watch) + web (Vite) together
```

The frontend runs at `http://localhost:5173` (proxying to the backend on `:3000`).

### Web Push notifications

Generate a VAPID key pair once with `npx web-push generate-vapid-keys` and set
`PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` and `PUSH_VAPID_SUBJECT`
(for example, `mailto:admin@your-domain.com`) on the server. Keep the private
key safe and reuse the same pair across all deploys. If you change the keys, the
app resubscribes the next time the user opens Linkord; until then, notifications
for the old subscription stop arriving. Without these variables the app still
works, but the Push option shows up as unavailable.

In production, set `APP_URL` to the public HTTPS origin and allow outbound
connections from the server to the browsers' push services. Each user enables
notifications under **Settings → Notifications** on each device. On iPhone/iPad
(iOS 16.4+), first add the site to the Home Screen, open it from the icon and
then enable the option; a regular Safari tab does not receive Web Push. On
Android Chrome, installing to the Home Screen is optional.

Messages, mentions, friend requests and invites trigger Push even with the app
closed. Delivery depends on the system permission, the device's connection and
the expiry time set by the push service. Message history stays in the database
and is loaded when Linkord is opened.

The app icon uses the Badging API when the browser offers it. The number is the
sum of unread messages and unread social notifications; mentions and invite
cards are not counted twice. The app queries the server on open, on regaining
focus and on receiving Push, and clears the badge when there is nothing pending
or on sign-out. On iPhone/iPad, the number appears on the app installed to the
Home Screen after notification permission is granted; turning off Linkord
notifications removes the badge. On Android Chrome, the system shows a dot when
a notification arrives, with no numeric count through the Badging API.
See the [WebKit documentation](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)
and the [MDN reference](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Display_badge_on_app_icon).

Registration is closed by default (an empty `REGISTRATION_CODE` means nobody can sign up). After creating your account, become an admin with:

```bash
npm run admin:grant -- <your-username>
```

### Main scripts

| Script | What it does |
|---|---|
| `npm run dev` | Backend (`tsx --watch`) + frontend (Vite) in parallel |
| `npm run build` | Compiles the backend (`tsc`) and builds the frontend (`vite build`) |
| `npm start` | Runs the already compiled backend (`server/dist/index.js`) |
| `npm test` | Backend tests (`node --test`) and frontend tests (`vitest`) |
| `npm run db:generate` | Generates a new migration from `server/src/db/schema.ts` |
| `npm run db:migrate` | Applies pending migrations |
| `npm run admin:grant -- <username>` | Grants the admin role to an existing account |
| `npm run db:preflight` / `db:repair` | Checks (and fixes) legacy data that would block a migration |
| `npm run db:rehearse` | Rehearses every migration on throwaway databases |

## Tests

- **Backend**: `node --test` (`server/tests/**/*.test.ts`). Needs neither a real Postgres nor LiveKit running.
- **Frontend**: Vitest + React Testing Library (`web/tests/**/*.test.tsx`).

```bash
npm test              # backend + frontend
npm run test:server   # backend only
npm run test:web      # frontend only
```

Runs automatically on every push/PR to `main`/`develop` ([`.github/workflows/test.yml`](.github/workflows/test.yml)).

## Environment variables

See [`.env.example`](.env.example). It covers server, database, accounts/session, LiveKit, uploads and abuse limits.

## Deploy

The image is built by the [`Dockerfile`](Dockerfile) (multi-stage: builds the frontend, compiles the TypeScript backend, and assembles a lean runtime with no devDependencies or source code). Production runs on [Dokploy](https://dokploy.com) from that `Dockerfile`, with no reverse proxy or systemd in the repository, since Dokploy already handles the domain, HTTPS and the proxy in front.

To run locally with Docker (app + Postgres, all in containers):

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml -f docker-compose.yml up -d
```

### Migrating groups to servers

Migrations `0043_servers_expand` and `0044_servers_contract` turn every group (and every bot) into a server. The server applies them by itself on boot (unless `MIGRATE_ON_BOOT=0`), behind the migration gate, so a deploy is the migration. This runbook is what to do **before** that deploy, so nothing is lost and nothing surprises you in production.

#### What the migration does

For each group or bot conversation:

- A server is created with the group's name, avatar, owner, status and creation date. Every member becomes a server member, keeping when they joined; pinned groups come first in the server rail.
- The group's own conversation row becomes the `#geral` text channel **with the same id**, under the category "Canais de texto". Messages, attachments, reactions, read markers, links and push URLs keep working.
- A voice channel "Geral" is created under "Canais de voz". Call invitation cards now point to it.
- Group invitations become server invitations, group sounds become server sounds, reports on a group now target its server.
- A bot becomes a server whose `#geral` is read-only for `@everyone`. Its webhook keeps its URL and takes the bot's name and avatar.

Ids of the new rows are derived from the group id (`md5('<kind>:' || group_id)`), so running the backfill twice produces the same result.

#### 1. Back up production

```bash
pg_dump --format=custom --no-owner --file=linkord-before-servers.dump "$DATABASE_URL_PROD"
```

Keep the file until the new version has been running for a while. Restoring it is the way back: the migration has no down step.

#### 2. Rehearse on a copy of that backup

Restore the dump into a throwaway local database and point the scripts at it. Nothing here touches production.

```bash
createdb linkord_prodcopy
pg_restore --no-owner --dbname=linkord_prodcopy linkord-before-servers.dump
export COPY_URL=postgres://linkord:linkord@localhost:5432/linkord_prodcopy
```

Check whether anything would block the migration:

```bash
npm run db:preflight -- --database-url=$COPY_URL
```

The gate refuses 0043 while a group with members has no owner. If the preflight reports one, see what the repair would do, then apply it (one transaction, every change logged in `data_repairs`):

```bash
npm run db:repair -- --database-url=$COPY_URL
npm run db:repair -- --database-url=$COPY_URL --apply
```

Record the counts before migrating:

```sql
select
  (select count(*) from messages) as messages,
  (select count(*) from attachments) as attachments,
  (select count(*) from message_reactions) as reactions,
  (select count(*) from conversations where type in ('group', 'bot')) as groups;
```

Migrate the copy:

```bash
DATABASE_URL=$COPY_URL npm run db:migrate
```

Then compare: `messages`, `attachments` and `reactions` must be unchanged, and `select count(*) from servers` must equal the old `groups` count. Run the app against the copy (`DATABASE_URL=$COPY_URL npm run dev`), open a few migrated servers and check history, attachments, unread counts and the soundboard.

#### 3. Run the synthetic rehearsal

```bash
npm run db:rehearse
```

It builds its own `linkord_rehearsal_*` databases with messy legacy data (including a group with no owner and a bot) and checks that every group becomes exactly one server, that `#geral` keeps the old id, that counts survive, that the structure matches what creating a server from the template produces, that a second run of the backfill changes nothing, that a refused migration leaves nothing half-applied, and that a repair failing midway is undone. It never touches `DATABASE_URL` or production.

#### 4. Deploy

Once the copy migrated cleanly, run the production repair if the preflight asked for one (`npm run db:repair -- --database-url=$DATABASE_URL_PROD --apply`), then deploy. On boot the server applies 0043 and 0044; if the gate refuses, it logs why and exits without starting, and the database stays as it was.

Clients on the previous version see the "update the app" screen (the protocol version went up) and reload into the new one.

## License

[MIT](LICENSE)
