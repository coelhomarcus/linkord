<p align="center">
  <img src="web/public/logo.svg" alt="Linkord" width="96">
</p>
<h1 align="center">Linkord</h1>
<p align="center"><b>Self-hosted chat and calls for the people you know</b></p>

<p align="center">
  <a href="#-features"><b>Features</b></a> •
  <a href="docs/DEVELOPMENT.md"><b>Development</b></a> •
  <a href="https://github.com/coelhomarcus/Linkord/issues"><b>Issues</b></a>
</p>

<br />

Linkord is a self-hosted place to chat and call with friends. Talk in direct messages, or create private servers with text and voice channels, roles, and invitations. There is no public server directory: people join through a friend or an invite link.

## 🌟 Features

- **Friends and direct messages**
  Find people by exact `@username`, send and manage friend requests, block users, and chat or call one-to-one.

- **Servers and channels**
  Create servers from a ready-to-use template, organize text and voice channels into categories, and manage roles, channel permissions, invites, kicks, and bans.

- **Chat and media**
  Send attachments up to 512 MB each (configurable with `MAX_ATTACHMENT_BYTES`), record voice messages of up to 5 minutes from the composer (blocked while you are in a call, since the call owns the microphone), share YouTube and Twitch links with automatic embeds, react, reply, edit, delete, and search messages.

- **Voice, video, and screen sharing**
  Join calls in voice channels or DMs with LiveKit. Each server also has its own soundboard.

- **Webhooks**
  Let deploys, monitors, and other services post into a channel. See the [webhook guide](docs/WEBHOOK.md).

- **Web Push**
  Receive alerts for messages, mentions, friend requests, and invites, even when Linkord is closed. The app icon can also show an unread badge where the browser supports it.

- **Presence status**
  Pick how you appear from the profile card that opens from the user panel (it also edits your profile and copies your user ID): Available, Idle (also set automatically after a few minutes away, configurable per device), Do Not Disturb (no push and no notification sounds; notifications still land in the list) or Invisible (you look offline to everyone but keep using the app). Invisible still shows you inside a call you join, to the people who can see that call, the same way your voice and video do. Add a custom status with an emoji, a short text and an optional expiry, or pick a game from your rotation; it shows as a thought bubble beside your avatar on your profile, where you edit or clear it. Your status follows your account to every device.

- **Server audit log**
  Each server keeps a log in its settings of who kicked, banned, changed roles, channels, permissions, invites, webhooks or sounds, moved someone out of a voice channel, or deleted someone else's message, with what changed and when. Members with the "View audit log" permission can filter it by person, action, target and period. Entries are kept for 90 days by default (`SERVER_AUDIT_RETENTION_DAYS`).

- **Administration**
  Manage users, servers, webhooks, reports, audit history, orphaned uploads, and the data retention report from `/admin`.

- **Profile and Wall**
  Show connected accounts on your profile and pick widgets for your Wall: recent anime from MyAnimeList, your GitHub profile and contribution calendar, and your favorite, liked, current and wished-for games, searched on IGDB.

- **Your preferences**
  Set up your profile, account and email, connected accounts, blocked people, theme, voice and video devices, which notification sounds play, language and 12- or 24-hour time.

## 🚀 Development

For local development, the frontend and backend run on the host and only PostgreSQL runs in Docker. Follow the [local development guide](docs/DEVELOPMENT.md) for setup and run instructions.

## 🐳 Docker deployment

The `Dockerfile` builds the web app and API into one image. Configure `.env` with your production database and secrets, then start the app:

```bash
cp .env.example .env
# Edit .env: set DATABASE_URL, LIVEKIT_*, APP_URL, and other production values
docker compose up -d --build
```

The container applies pending migrations on startup by default. Set `MIGRATE_ON_BOOT=0` to run migrations separately with `npm run db:migrate`. The compose file persists uploaded files in `./uploads` and backups in `./backups`.

**The container does not run as root.** The process runs as the `node` user (uid 1000) and cannot write to its own code, only to `./uploads` and `./backups`. Compose also sets `no-new-privileges` and drops every Linux capability. Docker creates a missing bind-mounted folder owned by root, so on a **new install** create both folders first, and on an **existing install** change the owner once before deploying this version, or uploads and backups fail with a permission error (on Dokploy, see below):

```bash
mkdir -p uploads backups
sudo chown -R 1000:1000 uploads backups
```

To confirm it, `docker compose exec app id` prints `uid=1000(node)`. Always use `-R`: a `chown` of the top folder alone leaves `tmp/` (where uploads in progress are kept) owned by root.

**On Dokploy** (an application built from the `Dockerfile`), the compose file above is not used, so give the application two bind mounts yourself: a host folder on `/app/uploads` and another on `/app/backups`. Without the second one, backups are written inside the container and lost on the next deploy. On the host, as root, create both folders for uid 1000 before the first deploy (the paths are examples):

```bash
mkdir -p /srv/linkord/uploads /srv/linkord/backups
chown -R 1000:1000 /srv/linkord/uploads /srv/linkord/backups
```

On an install that already has files, find where the folders really are and run the same `chown -R 1000:1000` on each `Source`. The container's name changes with every deploy, so take it from `docker ps` each time:

```bash
docker ps --format '{{.Names}}' | grep <app-name>
docker inspect <container> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
```

Then check from inside the container, which needs no restart after a `chown`:

```bash
docker exec <container> sh -c 'id; ls -ld /app/uploads /app/uploads/tmp /app/backups'
```

Every folder listed must belong to `node`. When one does not, the server logs `uploads folder is not writable` at startup, and every attachment and voice message fails with a 500 from `/api/attachments/init` (`EACCES` in the log). Profile pictures can still save, because they are written straight into the top folder, so they do not prove the folder is fine.

**Run a single instance.** Linkord does not scale horizontally today: do not put replicas behind a load balancer. The server keeps live state in the memory of its own process (who is online and in which call, caches, socket flood limits, upload reservations) and Socket.IO has no shared adapter, so a second instance would not see the first one's users, calls or limits. Uploaded files also live on the local `./uploads` disk. What would have to change for several instances is listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#single-instance-assumption).

### Backups

The database and `./uploads` have to be backed up together, and Linkord does it for you: `npm run backup` (in the container, `docker compose exec app node server/dist/scripts/backup.js`) writes a dated folder with a `pg_dump`, an archive of the uploads and a manifest to `./backups`, and keeps the newest `BACKUP_KEEP` (default 7). Running it does not stop the app. To schedule it, start the optional compose service with `docker compose --profile backup up -d backup`, or call the command from the host's cron (on Dokploy, `docker exec $(docker ps -qf name=<app-name>) node server/dist/scripts/backup.js`, with `/app/backups` mounted as above). `npm run restore` brings a backup back into an empty database and folder on a new server and checks that everything came across. Copy `./backups` off the machine as well, and keep your `.env` somewhere safe: it is not in the backup. The full guide, with the restore steps, is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#backup-and-restore).

**Security headers.** The server sends a Content-Security-Policy and `X-Frame-Options: DENY` on every response, built from `APP_URL`, `LIVEKIT_URL` and `KLIPY_API_KEY`, so set those to the real public URLs: a wrong `LIVEKIT_URL` blocks calls in the browser. Behind HTTPS it adds `Strict-Transport-Security`. The reverse proxy does not need to set any of these. Violations are logged as `content security policy violation`; `CSP_REPORT_ONLY=1` turns blocking off while still reporting. Details in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#content-security-policy).

See [`.env.example`](.env.example) for all server, database, session, LiveKit, push, upload, and rate limit settings. In production, set `APP_URL` to the public HTTPS origin and configure a stable Web Push VAPID key pair. For iPhone and iPad, users must add Linkord to the Home Screen before enabling Push notifications.

## 🧰 Commands

```bash
npm run dev           # API and web app in watch mode
npm run db:seed       # sample accounts, DMs and a server in the local database
npm run backup        # database dump + uploads archive in ./backups, with rotation
npm run check         # typecheck, lint, unit tests and production build
npm run test:e2e      # real browsers against a Docker stack (needs Docker and Chrome)
```

Unit tests use Node's test runner (backend) and Vitest with React Testing Library (frontend), and need neither a database nor LiveKit. The end-to-end suite (Playwright) drives several accounts through every feature, a redeploy and an upgrade from the production version. Every script, and what each end-to-end spec covers, is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#scripts).

## 🛠️ Built with

[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vite.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![Drizzle](https://img.shields.io/badge/Drizzle-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![LiveKit](https://img.shields.io/badge/LiveKit-2B2D42?style=for-the-badge&logo=webrtc&logoColor=white)](https://livekit.io/)

## 🤝 Contributing

Found a bug or have an idea? [Open an issue](https://github.com/coelhomarcus/Linkord/issues). Before opening a pull request, run `npm run check`. See [AGENTS.md](AGENTS.md) for repository conventions.

## License

[MIT](LICENSE)
