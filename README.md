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

- **Friends and direct messages**
  Find people by exact `@username`, send and manage friend requests, block users, and chat or call one-to-one.

- **Servers and channels**
  Create servers from a ready-to-use template, organize text and voice channels into categories, and manage roles, channel permissions, invites, kicks, and bans.

- **Chat and media**
  Send attachments up to 512 MB each (configurable with `MAX_ATTACHMENT_BYTES`), record voice messages of up to 5 minutes from the composer (blocked while you are in a call, since the call owns the microphone), share YouTube and Twitch links with automatic embeds, react, reply, edit, delete, and search messages (in Portuguese or English, with or without accents). Opening a conversation with unread messages draws a "New messages" line above the first one, which stays in place while you read (with a pill to jump back to it once it scrolls away). Mark a channel or DM as read from its right-click menu or with Esc while it is open, and a whole server from its icon's menu or its header menu; read state follows you to every tab and device.

- **Mentions**
  Type `@` in the composer to mention a member, a role, `@everyone` (everyone who can see the channel) or `@here` (the ones online). A mention lands in the notification list and as a push, and the message is highlighted for whoever it reached. Notifying `@everyone`, `@here` or any role takes the "Mention @everyone, @here and All Roles" permission; a role marked "Allow anyone to @mention this role" can be notified by any member. Without the permission the message is still sent, but its group mention notifies nobody.

- **Emojis**
  Type `:` and two letters in the composer to pick an emoji by its shortcode, or type a whole shortcode such as `:joy:` to turn it into the emoji; the ones you use most come first, on every device. The emoji picker (in the composer next to GIFs, in reactions and in your status) has search, frequently used emojis, a section per server, the standard categories, a skin tone choice and a preview; on a phone it opens as a bottom sheet. Emojis are drawn as Twemoji pictures in messages, reactions, pickers, statuses and sounds, and already in the message box while you type (a server emoji too, as soon as its closing `:` is typed), so they look the same on Windows, macOS, Linux and phones, including flags, skin tones and the newer sequences a system font may lack; the text underneath stays the real emoji, for copying and screen readers. The picker only offers emojis Twemoji has a picture for. Each server can have its own emojis, up to 50 still and 50 animated, uploaded and cropped from the server's settings and stored as small WebP files. Its members use them anywhere, in other servers and DMs too, in messages and as reactions, and whoever reads the message sees the picture even from outside that server. A deleted emoji stays in old messages as its `:name:`.

- **Stickers**
  Each server can have up to 30 stickers, still or animated (PNG, APNG, JPEG, GIF or WebP), uploaded from the server's settings with a related emoji, a name and an optional description that screen readers read in place of the picture. The picture is fitted whole into a 320 px square and stored as WebP, animated when the original was. A sticker is a message of its own, drawn large without a bubble: pick it from the composer's sticker button (a tab next to GIFs and emojis), which has search by name, description or emoji, frequently used stickers first and a section per server. Like server emojis, its members send them anywhere, in other servers and DMs too, and whoever reads the message sees the sticker even from outside that server. Stickers can be reacted to, replied to and deleted, not edited. A deleted sticker shows as unavailable in old messages.

- **Voice, video, and screen sharing**
  Join calls in voice channels or DMs with LiveKit. Each server also has its own soundboard, added to from the call's sound picker. That picker lists the sounds of every server you may use the soundboard of, frequently used ones first, and works in DM calls too: a sound from another server plays for everyone in the call, members of that server or not. Channel permissions decide who may connect, speak, and turn on a camera or share a screen there.

- **Webhooks**
  Let deploys, monitors, and other services post into a channel. See the [webhook guide](docs/WEBHOOK.md).

- **Web Push**
  Receive alerts for messages, mentions, friend requests, and invites, even when Linkord is closed. The app icon can also show an unread badge where the browser supports it.

- **Presence status**
  Pick how you appear from the profile card that opens from the user panel (it also edits your profile and copies your user ID): Available, Idle (also set automatically after a few minutes away, configurable per device), Do Not Disturb (no push and no notification sounds; notifications still land in the list) or Invisible (you look offline to everyone but keep using the app). Invisible still shows you inside a call you join, to the people who can see that call, the same way your voice and video do. Add a custom status with an emoji, a short text and an optional expiry, or pick a game from your rotation; it shows as a thought bubble beside your avatar on your profile, where you edit or clear it. Your status follows your account to every device.

- **Server audit log**
  Each server keeps a log in its settings of who kicked, banned, changed roles, channels, permissions, invites, webhooks, sounds, emojis or stickers, moved someone out of a voice channel, or deleted someone else's message, with what changed and when. Members with the "View audit log" permission can filter it by person, action, target and period. Entries are kept for 90 days by default (`SERVER_AUDIT_RETENTION_DAYS`).

- **Administration**
  Manage users, servers, webhooks, reports, audit history, orphaned uploads, and the data retention report from `/admin`.

- **Profile and Wall**
  Show connected accounts on your profile and pick widgets for your Wall: recent anime from MyAnimeList, your GitHub profile and contribution calendar, and your favorite, liked, current and wished-for games, searched on IGDB.

- **Account security**
  Turn on two-step login, which asks for a code sent to your email after the password. Get an email when a browser you have not used lately signs in to your account (on by default, with a link to end that session). See every browser signed in to your account (browser, system, address, when it signed in and was last used) and end any of them, or all but this one: the other browser is signed out at once. Changing your password keeps you signed in here and signs out everywhere else. Change your username from settings with your current password: it says whether a name is free as you type (in any letter case), and every signed-in browser stays signed in while the next login uses the new name. A session left unused for 14 days (configurable) ends on its own. Delete your own account from Settings → Account with your current password (and the emailed code when two-step login is on): it signs out everywhere and is deleted 14 days later, unless you sign in again before then, which cancels it. The deletion removes the account the way an admin's does (servers you own pass to their longest-standing member, an empty one is removed, your profile pictures go), and you get an email when it is scheduled and when it is done.

- **Your preferences**
  Set up your profile, account and email, connected accounts, blocked people, theme, voice and video devices, which notification sounds play, language and 12- or 24-hour time. The app can be installed: a dismissible banner offers it after a few visits (never during a call), the Notifications page keeps an entry for it, and on iPhone it explains Share → Add to Home Screen, which Web Push needs. On Android Chrome the installed app also appears in the system share sheet: share photos, videos, files, text or a link from any app, choose a conversation or channel on the "Send to…" page, and everything lands in that composer, ready to caption and send. iOS has no equivalent (Safari does not support `share_target`), so there it only works by opening the app and attaching the file.

## 🚀 Development

For local development, the frontend and backend run on the host and only PostgreSQL runs in Docker. Follow the [local development guide](docs/DEVELOPMENT.md) for setup and run instructions.

## 🐳 Deployment

Linkord ships as one Docker image (web app, API and realtime server on port 3000) next to a PostgreSQL database and a LiveKit server. It runs with Docker Compose or on Dokploy. The [deployment guide](docs/DEPLOY.md) covers the environment it needs, the folders it writes to and their permissions, updates while people are connected, security headers, backups and troubleshooting.

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
