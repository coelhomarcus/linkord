# Deployment

How to run Linkord in production, what the container expects from the host, and what to look at when something breaks. For running it on your own machine see [DEVELOPMENT.md](DEVELOPMENT.md); every environment variable is described in [`.env.example`](../.env.example).

## What gets deployed

One Docker image, built by the [`Dockerfile`](../Dockerfile), holds everything: the web app (`web/dist`), the API, the realtime server (Socket.IO on the `/ws` path) and the backup scripts with the PostgreSQL client tools. A single Node process serves all of it on port **3000**, so the reverse proxy needs one route to one port, websockets included.

- **Health check:** `GET /healthz` answers `{ ok, participants, uptime }`. The image already uses it as its `HEALTHCHECK`.
- **Behind a proxy:** the image sets `TRUST_PROXY=1`, so client addresses (also the ones stored with each login session and shown to the account in Settings → Security) and `X-Forwarded-Proto` come from the proxy. With `COOKIE_SECURE=auto` (the default) the session cookie is `Secure` whenever the proxy says the request was HTTPS.
- **Migrations** run at startup (`MIGRATE_ON_BOOT=1`, the default) before the server accepts connections; if one fails, the process exits with the reason in the log. Set `MIGRATE_ON_BOOT=0` to run them yourself with `node server/dist/db/migrate.js`.
- **Not root:** the process runs as `node` (uid 1000). It cannot rewrite its own code and can only write to `/app/uploads` and `/app/backups`, which is why those two folders need the right owner on the host ([Folders and permissions](#folders-and-permissions)).

## Before you start

- **PostgreSQL** 17 is what development and the tests use. The backup tools in the image follow the newest Alpine release and must be at least as new as the server.
- **LiveKit** for voice, video and screen sharing: LiveKit Cloud or a self-hosted server ([INTEGRATIONS.md](INTEGRATIONS.md#livekit)).
- **A domain with HTTPS.** Web Push, the `Secure` cookie, `Strict-Transport-Security` and Chrome's CSP reports all need it.

The variables a production instance needs:

| Variable | What to put there |
| --- | --- |
| `DATABASE_URL` | The database the app owns. `DATABASE_SSL=1` when it is reached over TLS. |
| `APP_URL` | The public origin, `https://chat.example.com`, no trailing slash. Used in emails, push, the origin check and the Content-Security-Policy. |
| `REGISTRATION_CODE` | Empty means nobody can sign up. Set a code and share it with the people you invite. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The URL browsers really use to reach LiveKit (`wss://…`). The CSP only lets the browser connect there. |
| `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` | All three or none. Generate them once (`npx web-push generate-vapid-keys`) and keep them: new keys break every existing subscription. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional. Without them, password recovery, email changes and two-step login are unavailable. Once people turn two-step login on, removing them locks those accounts out ([Resend](INTEGRATIONS.md#resend)). |

Optional services (KLIPY, MyAnimeList, IGDB) and every limit are in `.env.example`. Covers, GitHub avatars, link preview pictures and YouTube thumbnails are downloaded by the server and served from its own domain, which costs outbound bandwidth and up to 64 MB of memory for the cache; `MEDIA_PROXY=0` sends browsers to those services instead ([media proxy](INTEGRATIONS.md#media-proxy)). After the first start, make yourself an administrator: `node server/dist/scripts/adminRole.js grant <username>` inside the container (`npm run admin:grant -- <username>` from a checkout).

## Docker Compose

[`docker-compose.yml`](../docker-compose.yml) runs the image with `.env`, publishes port 3000 and mounts `./uploads` and `./backups`. It sets no reverse proxy: put the TLS proxy you already have in front of it.

```bash
cp .env.example .env
# set DATABASE_URL, APP_URL, LIVEKIT_* and the rest
mkdir -p uploads backups
sudo chown -R 1000:1000 uploads backups
docker compose up -d --build
```

The compose file also sets `no-new-privileges` and drops every Linux capability, and has an optional `backup` service ([Backups](#backups)).

## Dokploy

Create an **application** built from the repository's `Dockerfile` (the compose file is not used). Then:

1. **Environment:** paste the variables above. `TRUST_PROXY` is already set by the image.
2. **Database:** a PostgreSQL service in Dokploy works; use the internal host name Dokploy shows for it in `DATABASE_URL`.
3. **Domain:** point it at container port `3000` with HTTPS. Websockets need nothing extra.
4. **Mounts:** two bind mounts, a host folder on `/app/uploads` and another on `/app/backups`. Without the second one, backups are written inside the container and disappear on the next deploy. Before the first deploy, create both folders on the host, as root, for uid 1000 (the paths are examples):

```bash
mkdir -p /srv/linkord/uploads /srv/linkord/backups
chown -R 1000:1000 /srv/linkord/uploads /srv/linkord/backups
```

Dokploy runs the app as a Swarm service, so the container's name changes with every deploy (`<app-name>.1.<task id>`). Take it from `docker ps` each time you need it:

```bash
docker ps --format '{{.Names}}' | grep <app-name>
```

## Folders and permissions

The app writes to two places and nothing else:

| Container path | What is there |
| --- | --- |
| `/app/uploads` | Every stored file: attachments, thumbnails, profile images, soundboard sounds, server emojis. `tmp/` inside it holds the chunks of uploads still in progress, one folder per upload. |
| `/app/backups` | One dated folder per backup (`BACKUP_DIR`). |

Both must belong to uid 1000 **all the way down**. Docker creates a missing bind-mounted folder owned by root, and an install from before the image switched to `node` has root-owned files and folders inside. Always use `chown -R`: changing only the top folder leaves `tmp/` owned by root, and then profile pictures still save (they are written straight into `/app/uploads`) while every attachment and voice message fails.

To see where the folders live on the host and fix them:

```bash
docker inspect <container> --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
chown -R 1000:1000 <each Source path>
```

To check, from inside the container (no restart is needed after a `chown`):

```bash
docker exec <container> sh -c 'id; ls -ld /app/uploads /app/uploads/tmp /app/backups'
```

Every folder listed must belong to `node`. When one does not, the server logs `uploads folder is not writable` at startup with the folders it cannot write.

## Updating

A deploy replaces the container while people are connected, and is meant to be safe:

- **Calls continue.** Audio and video flow between the browsers and LiveKit, and the server keeps who is in which call in PostgreSQL, so after the restart it waits `CALL_RESTORE_GRACE_MS` (90 s by default) for everyone to reconnect to the same call.
- **Messages and uploads wait.** A message sent while the server is down is sent again once it is back, and an upload retries for up to 60 seconds of outage.
- **Old tabs** keep running the previous build until they reload. If the new version changed the realtime protocol in a way old tabs cannot handle, they are shown a "reload the page" screen and leave any call they were in. That only happens when a release says so.

What keeps this working, and the rules for changing it, is in [`AGENTS.md`](../AGENTS.md) ("Realtime compatibility and deploys").

## Security headers

The server sets its own security headers on every response, so the proxy does not need to add any (and should not add another `Content-Security-Policy`, which browsers would enforce on top of this one):

- `Content-Security-Policy`, built at startup from `APP_URL`, `LIVEKIT_URL` and `KLIPY_API_KEY`. A wrong `LIVEKIT_URL` blocks calls in the browser even if the server can reach LiveKit.
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`: no other site can show Linkord in a frame.
- `Strict-Transport-Security` (one year, without `includeSubDomains`) on HTTPS requests.

Violations are logged as `content security policy violation`, with the directive and what was blocked. A proxy or CDN that injects its own scripts into pages shows up there: Cloudflare's Web Analytics adds `static.cloudflareinsights.com/beacon.min.js`, which the policy blocks. Turn that injection off in Cloudflare, or allow its hosts in the policy if you want the analytics. `CSP_REPORT_ONLY=1` stops blocking while still reporting, for trying out a change. How the policy is built and how to add a domain: [DEVELOPMENT.md](DEVELOPMENT.md#content-security-policy).

## Backups

The database and the uploads have to be backed up together, and the image does it: `node server/dist/scripts/backup.js` writes a dated folder with a `pg_dump`, an archive of `/app/uploads` (without `tmp/`) and a manifest to `/app/backups`, and keeps the newest `BACKUP_KEEP` (7 by default). It does not stop the app.

```bash
# Docker Compose
docker compose exec app node server/dist/scripts/backup.js
# Dokploy (from the host)
docker exec $(docker ps -qf name=<app-name>) node server/dist/scripts/backup.js
```

To schedule it, use the compose `backup` service (`docker compose --profile backup up -d backup`) or the host's cron with the command above. A backup on the same disk does not survive that disk: copy `/app/backups`'s host folder off the machine after each run, and keep `.env` somewhere safe, because it is not in the backup. Restoring on a new server, the checks it runs and the rehearsal: [DEVELOPMENT.md](DEVELOPMENT.md#backup-and-restore).

## One instance only

Run a single container. The server keeps live state in its own memory (who is online and in which call, caches, flood limits, upload reservations), Socket.IO has no shared adapter, and files live on the local disk, so a second instance behind a load balancer would not see the first one's users, calls or limits. What would have to change: [DEVELOPMENT.md](DEVELOPMENT.md#single-instance-assumption).

## Troubleshooting

- **Attachments and voice messages fail, profile pictures work.** `POST /api/attachments/init` answers 500 and the log shows `EACCES: permission denied, mkdir '/app/uploads/tmp/…'`. A folder under the uploads mount is still owned by root: see [Folders and permissions](#folders-and-permissions). The 429s that follow are the browser retrying.
- **Backups fail with `EACCES`.** The same, for the folder mounted on `/app/backups`, or nothing is mounted there.
- **Calls do not connect, chat works.** Check `LIVEKIT_URL`: it must be the address browsers use, and the browser console names it in a Content-Security-Policy error if the policy blocked it. Without `LIVEKIT_*` the server logs `LiveKit is not configured` at startup.
- **Covers, avatars or link preview pictures are missing.** The server downloads them itself, so the container needs outbound HTTPS to `images.igdb.com`, `cdn.myanimelist.net`, `avatars.githubusercontent.com`, `i.ytimg.com` and the sites people link to. The browser's network tab shows the reason on the `/api/media-proxy/...` request (`502 image_unavailable`, `429 rate_limited`, `415 not_an_image`).
- **"Origem não permitida." (403) on every change, or the socket refuses to connect.** That is the app's own Portuguese error for a request from an origin it does not know. `APP_URL` must match the address in the browser; other addresses go in `ALLOWED_ORIGINS`.
- **Signing in seems to work, but the next page is signed out.** The session cookie is marked `Secure` while the browser uses a plain `http://` address, so the browser drops it. Serve the app over HTTPS, or leave `COOKIE_SECURE=auto` instead of `1`.
- **The server refuses to start** with a message about `PUSH_VAPID_*` or `APP_URL`: Web Push needs all three keys and an HTTPS `APP_URL`.
