<p align="center">
  <img src="web/public/logo.svg" alt="Linkord" width="96">
</p>
<h1 align="center">Linkord</h1>
<p align="center"><b>Self-hosted chat and calls for the people you know</b></p>

<p align="center">
  <a href="#-features"><b>Features</b></a> •
  <a href="docs/DEVELOPMENT.md"><b>Development</b></a> •
  <a href="docs/DEPLOY.md"><b>Deployment</b></a> •
  <a href="https://github.com/coelhomarcus/Linkord/issues"><b>Issues</b></a>
</p>

<br />

Linkord is a self-hosted place to chat and call with friends. Talk in direct messages, or create private servers with text and voice channels, roles, and invitations. There is no public server directory: people join through a friend or an invite link.

## 🌟 Features

**Chat**
- Direct messages and private servers with text channels, organized into categories.
- Replies, reactions, edits, deletes, and message search.
- Attachments, voice messages, and automatic YouTube and Twitch embeds.
- Mentions of members, roles, `@everyone` and `@here`.
- Emojis, GIFs, and stickers, plus custom emojis and stickers per server.
- Unread markers that sync across tabs and devices.

**Voice and video**
- Voice channels and one-to-one DM calls, with camera and screen sharing.
- One call per account: every tab and device shows the call you are in, and can take it over after asking.
- A soundboard per server, usable in any call.

**Servers**
- Roles, channel permissions, invite links, kicks, and bans.
- Server templates to get started quickly.
- Audit log of moderation and settings changes.
- Webhooks so deploys, monitors, and other services can post into a channel ([guide](docs/WEBHOOK.md)).

**People**
- Friends by exact `@username`, friend requests, and blocking.
- Presence (available, idle, do not disturb, invisible) and custom statuses.
- Profile with connected accounts and a Wall of widgets: MyAnimeList, GitHub, and games from IGDB.

**Notifications**
- Web Push for messages, mentions, friend requests, and invites, plus an unread badge on the app icon.
- Notification level and mute per server, channel, and DM.

**Account**
- Two-step login by email, sign-in alerts, and a list of active sessions you can end.
- Username and password changes, account deletion, and a download of your data.
- Themes, languages (Portuguese and English), device settings, and notification sounds.
- Installable as an app, with share-to-Linkord on Android.

**Administration**
- An `/admin` area for users, servers, webhooks, reports, audit history, and uploads.

## ⚡ Quick start

All you need is Docker with the Compose plugin. This brings up the app, PostgreSQL and a LiveKit server for calls:

```bash
git clone <this repository> && cd linkord
cp .env.full.example .env.full   # fill in REGISTRATION_CODE, POSTGRES_PASSWORD, LIVEKIT_API_KEY and LIVEKIT_API_SECRET
docker compose --env-file .env.full -f docker-compose.full.yml up -d --build
```

Open [http://localhost:3000](http://localhost:3000) and create an account with the registration code. Emailed codes (account recovery, two-step login) are printed by `docker compose --env-file .env.full -f docker-compose.full.yml logs mailsink`. Data is kept in Docker volumes across `down` and `up`. More, including how to serve other machines over HTTPS, in [the whole stack in Docker](docs/DEVELOPMENT.md#the-whole-stack-in-docker).

## 🚀 Development

For local development, the frontend and backend run on the host and only PostgreSQL runs in Docker. Follow the [local development guide](docs/DEVELOPMENT.md) for setup and run instructions.

## 🐳 Deployment

Linkord ships as one Docker image (web app, API and realtime server on port 3000) next to a PostgreSQL database and a LiveKit server. It runs with Docker Compose (on its own, or with PostgreSQL and LiveKit bundled by `docker-compose.full.yml`) or on Dokploy. The [deployment guide](docs/DEPLOY.md) covers the environment it needs, the folders it writes to and their permissions, updates while people are connected, security headers, backups and troubleshooting.

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

Emoji pictures are [Twemoji](https://github.com/discord/twemoji) by Twitter, Inc and other contributors, licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
