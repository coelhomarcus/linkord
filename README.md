<p align="center">
  <img src="web/public/logo.svg" alt="Linkord" width="120" />
</p>

<h1 align="center">Linkord</h1>

<p align="center">
  Self-hosted real-time communication: friends, groups and calls.
</p>

<p align="center">
  <a href="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml">
    <img src="https://github.com/coelhomarcus/Linkord/actions/workflows/test.yml/badge.svg" alt="CI" />
  </a>
</p>

## What it is

Linkord is a self-hosted chat and calling platform, Discord-style, but organized around **friends and groups** rather than public servers and channels. Each account adds friends by exact `@username`, talks over DMs or creates its own groups (with invites and acceptance), and calls by voice, video or screen share inside those conversations.

- **Friends**: friend requests, accept/decline, blocking
- **Conversations**: DMs and groups. Any account can create a group and owns it (rename, invite, remove members, transfer ownership)
- **Chat**: attachments (chunked uploads, up to 2GB), automatic embeds (YouTube/Twitch/direct media/Open Graph), reactions, replies, edit/delete messages, search
- **Calls**: voice, camera and screen sharing per conversation (LiveKit)
- **Administration** (`/admin`): users, groups, reports, audit log and orphaned file cleanup
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

## License

[MIT](LICENSE)
