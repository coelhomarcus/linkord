# Deployment

How to run Linkord in production, what the container expects from the host, and what to look at when something breaks. For running it on your own machine see [DEVELOPMENT.md](DEVELOPMENT.md); every environment variable is described in [`.env.example`](../.env.example).

## What gets deployed

One Docker image, built by the [`Dockerfile`](../Dockerfile), holds everything: the web app (`web/dist`), the API, the realtime server (Socket.IO on the `/ws` path) and the backup scripts with the PostgreSQL client tools. A single Node process serves all of it on port **3000**, so the reverse proxy needs one route to one port, websockets included. The same image also holds the optional [playground service](#playground-service), a second process you run as its own container.

- **Health checks:** both public, both answer only `{ ok: … }`.
  - `GET /healthz` (liveness): `200` while the process serves HTTP. The image's `HEALTHCHECK`, Dokploy and the end-to-end stack use it.
  - `GET /readyz` (readiness): `200` when PostgreSQL answers within 1 s and the upload folders are writable, `503` otherwise, cached for 5 s. The log says what failed (`not ready` under the `health` component). Point monitoring at it. The container's health check stays on `/healthz` on purpose: with [one instance](#one-instance-only), restarting the container on a database outage would drop every call and fix nothing.
- **Behind a proxy:** the image sets `TRUST_PROXY=1`. The client address is the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` places from the right (default `1`, one proxy such as Traefik). With a CDN or a second proxy in front, set it to the number of proxies: too low and callers pick their own address and escape the per-IP limits, too high and everyone shares one address. With `COOKIE_SECURE=auto` (the default) the session cookie is `Secure` whenever the proxy says the request was HTTPS.
- **Migrations** run at startup (`MIGRATE_ON_BOOT=1`, the default) before the server accepts connections; if one fails, the process exits with the reason in the log. Set `MIGRATE_ON_BOOT=0` to run them yourself with `node server/dist/db/migrate.js`.
- **Not root:** the process runs as `node` (uid 1000). It cannot rewrite its own code and can only write to `/app/uploads` and `/app/backups`, which is why those two folders need the right owner on the host ([Folders and permissions](#folders-and-permissions)).

## Before you start

- **PostgreSQL** 17 is what development and the tests use. The backup tools in the image follow the newest Alpine release and must be at least as new as the server. The migrations create the `unaccent` and `pg_trgm` extensions (message search); both ship with the official images and are trusted, so the user in `DATABASE_URL` needs no superuser rights, only `CREATE` on its database (which the database's owner has). A server without the contrib extensions fails that migration at startup.
- **LiveKit** for voice, video and screen sharing: LiveKit Cloud or a self-hosted server ([INTEGRATIONS.md](INTEGRATIONS.md#livekit)).
- **A domain with HTTPS.** Web Push, the `Secure` cookie, `Strict-Transport-Security` and Chrome's CSP reports all need it.

The variables a production instance needs:

| Variable | What to put there |
| --- | --- |
| `DATABASE_URL` | The database the app owns. `DATABASE_SSL=1` when it is reached over TLS. `DATABASE_POOL_MAX` (default 10) is how many connections it keeps open; keep it below the server's `max_connections`. |
| `APP_URL` | The public origin, `https://chat.example.com`, no trailing slash. Used in emails, push, the origin check and the Content-Security-Policy. |
| `REGISTRATION_CODE` | Empty means nobody can sign up. Set a code and share it with the people you invite. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The URL browsers really use to reach LiveKit (`wss://…`). The CSP only lets the browser connect there. |
| `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` | All three or none. Generate them once (`npx web-push generate-vapid-keys`) and keep them: new keys break every existing subscription. |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional. Without them, password recovery, email changes and two-step login are unavailable, and older accounts that still have no email cannot get past the screen asking them to link one. Once people turn two-step login on, removing them locks those accounts out ([Resend](INTEGRATIONS.md#resend)). |

Optional services and limits are in `.env.example`. Steam Wall connections use `STEAM_WEB_API_KEY`, and Twitch connections share the IGDB app credentials. Covers, connection avatars, link preview pictures and thumbnails are downloaded by the server and served from its own domain, which costs outbound bandwidth and up to 64 MB of memory for the cache (another 64 MB for the background loops of Steam mini profiles); `MEDIA_PROXY=0` sends browsers to those services instead ([media proxy](INTEGRATIONS.md#media-proxy)). After the first start, make yourself an administrator: `node server/dist/scripts/adminRole.js grant <username>` inside the container (`npm run admin:grant -- <username>` from a checkout).

## The complete stack on one server

The `full` profile of [`docker-compose.yml`](../docker-compose.yml) runs the image next to PostgreSQL, LiveKit and a mail sink, so a single small server needs nothing else. How to start it (`docker compose --env-file .env.full up -d --build`) and what each service does is in [DEVELOPMENT.md](DEVELOPMENT.md#the-whole-stack-in-docker). Production keeps deploying through [Dokploy](#dokploy), with a managed database and LiveKit Cloud; the compose file fits a trial, a demo or a small private instance that accepts what comes with it: the database, the uploads and LiveKit share one machine and one disk, and nothing restarts the app on another host when that machine goes down. It runs one LiveKit node with no TURN server. To run the image against a database and LiveKit you already have, use [Dokploy](#dokploy) or [the image on its own](#the-image-on-its-own).

On a server, fill in every required value of `.env.full`: left empty, the database password and the LiveKit key pair fall back to the development defaults, which anyone can look up.

By default everything is published on `127.0.0.1` only, which serves browsers on that machine. To serve other machines:

1. **DNS:** two names pointing at the server, one for the app and one for LiveKit's signalling (`linkord.example.com`, `livekit.example.com`).
2. **`.env.full`:**

```dotenv
COMPOSE_PROFILES=full,https
APP_DOMAIN=linkord.example.com
LIVEKIT_DOMAIN=livekit.example.com
APP_URL=https://linkord.example.com
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_NODE_IP=<the server's public IPv4>
LIVEKIT_RTC_BIND=0.0.0.0
```

3. **Start it.** The `https` profile adds Caddy in front of the app and LiveKit's signalling, with Let's Encrypt certificates kept in the `linkord_caddy_data` volume:

```bash
docker compose --env-file .env.full up -d --build
```

4. **Firewall:** open `80/tcp` and `443/tcp` (Caddy; `443/udp` too for HTTP/3), `7881/tcp` and `7882/udp` (LiveKit media). Keep `3000`, `3100`, `5432`, `5433`, `7880` and `8025` closed; the file publishes them on `127.0.0.1` only.

Why this shape:

- **The app's port stays on loopback**, because the image trusts `X-Forwarded-For`; Caddy replaces whatever a client sends with the address it saw.
- **HTTPS is required off `localhost`:** browsers give the microphone and camera only to a secure context, and Web Push and the `Secure` cookie need it.
- **LiveKit media goes straight to the server**, not through Caddy, on `7881/tcp` and the single UDP port `7882` ([`docker/livekit.yaml`](../docker/livekit.yaml)). Behind NAT, `LIVEKIT_NODE_IP` is the public address and those ports are forwarded.
- **No TURN:** browsers behind a firewall that blocks both UDP and TCP to `7881` cannot join calls (chat still works). LiveKit's embedded TURN server (`turn:` in `livekit.yaml`) would fix it; LiveKit Cloud includes one.

Backups: add `backup` to `COMPOSE_PROFILES` (see [Backups](#backups)), and keep `.env.full` with them, since the database and LiveKit secrets are only there.

## The image on its own

Without Compose or Dokploy, build the image and run it with your `.env` (`DATABASE_URL`, `APP_URL`, `LIVEKIT_*` and the rest), behind the TLS proxy you already have:

```bash
docker build -t linkord .
mkdir -p uploads backups
sudo chown -R 1000:1000 uploads backups
docker run -d --name linkord --restart unless-stopped --env-file .env \
  -p 127.0.0.1:3000:3000 -v "$PWD/uploads:/app/uploads" -v "$PWD/backups:/app/backups" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 linkord
```

The port stays on `127.0.0.1` for the same reason as above: the image trusts `X-Forwarded-For`, so only the proxy may reach it.

## Dokploy

Create an **application** built from the repository's `Dockerfile` (not a Compose service: `docker-compose.yml` is for development and the single-server stack). Then:

1. **Environment:** paste the variables above. `TRUST_PROXY` is already set by the image.
2. **Database:** a PostgreSQL service in Dokploy works; use the internal host name Dokploy shows for it in `DATABASE_URL`.
3. **Domain:** point it at container port `3000` with HTTPS. Websockets need nothing extra.
4. **Mounts:** two bind mounts, a host folder on `/app/uploads` and another on `/app/backups`. Without the second one, backups are written inside the container and disappear on the next deploy. Before the first deploy, create both folders on the host, as root, for uid 1000 (the paths are examples):

```bash
mkdir -p /srv/linkord/uploads /srv/linkord/backups
chown -R 1000:1000 /srv/linkord/uploads /srv/linkord/backups
```

**Restart policy.** The app relies on being restarted when it exits: an uncaught exception or an unhandled promise rejection is logged as `fatal uncaughtException, shutting down` (or `unhandledRejection`), the server shuts down the same way as for a deploy (calls are restored by the next process) and exits with code 1. The compose file and the `docker run` above set `restart: unless-stopped`. On Dokploy, the Swarm service's default restart policy (`condition: any`) already restarts it; if you changed it under the application's Swarm settings, keep the condition at `any` or `on-failure`. To check:

```bash
docker service inspect <app-name> --format '{{json .Spec.TaskTemplate.RestartPolicy}}'
```

Dokploy runs the app as a Swarm service, so the container's name changes with every deploy (`<app-name>.1.<task id>`). Take it from `docker ps` each time you need it:

```bash
docker ps --format '{{.Names}}' | grep <app-name>
```

## Playground service

The worlds, inventories, fighting, experience and skins of playground channels run in a service of their own, so restarting or losing it never touches the chat or anyone's call, and deploying the app no longer resets the game. It is optional, and `PLAYGROUND_URL` on the app is its switch: unset, nobody can create a playground channel, and the ones that exist open as ordinary voice channels (tiles, no 3D world or game chat) until it is set again, since each channel keeps its mode. How it fits with the app is in [DEVELOPMENT.md](DEVELOPMENT.md#playground-channels).

- **One service or two.** The service is its own process either way, from the app's own image:
  - **Inside the app's container** (`PLAYGROUND_EMBEDDED=1` on the app): the app starts it next to itself on `PLAYGROUND_EMBEDDED_PORT` (default `3100`) and reaches it there, and it hands the browsers' game connection (the websocket on `/playground/ws`) on to it from its own port, so the proxy in front needs no route of its own for the service. If it crashes, the app logs it and starts it again (after 1 s, then up to 30 s), and never goes down with it; a deploy of the app restarts both, which resets health but keeps the worlds (saved as the service stops), inventories, experience and skins. One service to run, one set of variables.
  - **In a container of its own:** run the image a second time with `node playground/dist/index.js`. It listens on `3000` there (`PLAYGROUND_PORT`), and restarts and deploys apart from the app.

  Either way it answers `GET /healthz` and `GET /readyz` (with its database) and migrates its database when it starts.
- **Its own PostgreSQL database**, never the app's: `PLAYGROUND_DATABASE_URL` (`PLAYGROUND_DATABASE_SSL=1` over TLS). It needs only `CREATE` on it. It holds each playground's world (a few tens of kB each, with everything its players built), what each account carries there, experience and skins (health is kept in memory), and the app's [backups](#backups) leave it out: `pg_dump` it yourself if that matters.
- **A shared secret:** set the same `PLAYGROUND_SECRET` (at least 32 characters, `openssl rand -hex 32`) on the app and on the service (in one container, that is one variable). The app signs a short-lived pass with it for each player; the service accepts no one without one. Changing it makes every player reconnect once.
- **Where browsers reach it:** `PLAYGROUND_URL` on the app, an origin. The service answers on `/playground/ws` there, as a websocket. On the app's own domain (recommended: no extra name, certificate or CSP change), route the path `/playground/` to the service's container and everything else to the app; with the service inside the app's container, the app does that itself. If nothing answers there, the game stays on a loading screen that says it cannot reach the game server (check with `curl https://<your domain>/playground/healthz`, which should answer `{"ok":true}` from a service in its own container). On a name of its own, set that origin; the app adds it to its Content-Security-Policy.
- **The app calls it too,** at `PLAYGROUND_INTERNAL_URL` (default `PLAYGROUND_URL`) under `/playground/internal/`, each request signed with the secret: to tell it which accounts were deleted, so their skin, experience and inventories go, and to hand it the skins saved in the app before the service kept them. Both wait in the app's database until the service took them, so a service that is down only delays them (the log says `could not reach the playground service`). In one container it is the local port; with two, point `PLAYGROUND_INTERNAL_URL` at the service's container when the app can reach it directly (through the public address it works too).
- **Turning it on:** in its own container, deploy the service first; then set `PLAYGROUND_URL` and `PLAYGROUND_SECRET` (and, for one container, `PLAYGROUND_EMBEDDED=1` and `PLAYGROUND_DATABASE_URL`) on the app and redeploy it. Within a minute the app hands the service the skins it had kept; until then people wear their default. Turning it off is removing `PLAYGROUND_URL` from the app and redeploying it: playground channels become voice channels for everyone at once (open tabs too, on their reconnect); the service's database stays as it is, and accounts deleted meanwhile are not forgotten there.
- **Compose:** the `playground` profile runs it next to its own `playground-postgres` ([DEVELOPMENT.md](DEVELOPMENT.md#the-whole-stack-in-docker)); with `https`, Caddy already routes `/playground/` to it, so set `PLAYGROUND_URL` to the app's address.
- **Dokploy, in the app's container:** on the existing application, add `PLAYGROUND_EMBEDDED=1`, `PLAYGROUND_URL` (the same as `APP_URL`), `PLAYGROUND_SECRET` and `PLAYGROUND_DATABASE_URL` (a second database, on the same PostgreSQL service or another), and redeploy. The app passes the game's websocket on to the service itself; no second domain is needed (one on the same host name with the path `/playground`, not stripped, on container port `3100` also works).
- **Dokploy, in a container of its own:** a second application from the same repository and `Dockerfile`, with the run command `node playground/dist/index.js`, `PLAYGROUND_DATABASE_URL`, `PLAYGROUND_SECRET`, no mounts, and a domain on the app's host name with the path `/playground` (not stripped) on container port `3000`; then the app's variables as above, without `PLAYGROUND_EMBEDDED`.

## Folders and permissions

The app writes to two places and nothing else:

| Container path | What is there |
| --- | --- |
| `/app/uploads` | Every stored file: attachments, thumbnails, profile images, soundboard sounds, server emojis and stickers, and the icons shown with someone's activity, games' and apps' alike (`activity-icons/`). `tmp/` inside it holds the chunks of uploads still in progress, one folder per upload. `exports/` holds the ZIPs of "Download my data" (`EXPORT_DIR`, see below). |
| `/app/backups` | One dated folder per backup (`BACKUP_DIR`). |

**Data exports** (Settings → Data & privacy) are ZIPs of a person's profile, settings, activity, friends, servers, sent messages and their files, written to `EXPORT_DIR` (default `/app/uploads/exports`), downloadable by that account for 7 days and then deleted. Each is about the size of the person's attachments, at most one request per account per day. Keep `EXPORT_DIR` on a mounted volume, or a deploy drops ready files and their links answer 404. Backups leave exports out.

Both must belong to uid 1000 **all the way down**. Docker creates a missing bind-mounted folder owned by root, and installs from before the image ran as `node` have root-owned files inside. Always use `chown -R`: with only the top folder fixed, profile pictures still save but every attachment and voice message fails (`tmp/` stays root's).

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

The server sets its own security headers, so the proxy needs to add none (and must not add a second `Content-Security-Policy`, which browsers would enforce on top):

- `Content-Security-Policy`, built at startup from `APP_URL`, `LIVEKIT_URL`, `PLAYGROUND_URL`, `KLIPY_API_KEY`, `MEDIA_PROXY` and the frontend build. A wrong `LIVEKIT_URL` blocks calls in the browser even when the server reaches LiveKit. How it is built and how to allow a new host: [DEVELOPMENT.md](DEVELOPMENT.md#content-security-policy).
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`: no other site can frame Linkord.
- `Strict-Transport-Security` (one year, without `includeSubDomains`) on HTTPS requests.

Browsers report violations to `POST /api/csp-reports`, and the server logs them as `content security policy violation`. A proxy or CDN that injects scripts shows up there: Cloudflare's Web Analytics beacon (`static.cloudflareinsights.com`) is blocked, so turn that injection off. `CSP_REPORT_ONLY=1` reports without blocking.

## Backups

The database and the uploads must be backed up together, and the image does it without stopping the app: `node server/dist/scripts/backup.js` (`npm run backup` from a checkout) writes one folder to `BACKUP_DIR` (`/app/backups` in the image):

```
linkord-backup-20261108T015300Z/
  database.dump     pg_dump, custom format
  uploads.tar.gz    the uploads, without tmp/ and exports/
  manifest.json     row counts, migrations, file counts, SHA-256 of both files
```

```bash
# the complete stack on one server
docker compose --env-file .env.full exec app node server/dist/scripts/backup.js
# Dokploy (from the host)
docker exec $(docker ps -qf name=<app-name>) node server/dist/scripts/backup.js
```

| Setting | Default | What it does |
| --- | --- | --- |
| `BACKUP_DIR` | `./backups` | Where backups are written and read. Not inside `UPLOAD_DIR`. |
| `BACKUP_KEEP` | `7` | How many backups rotation keeps (at least 1). |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Only for the compose `backup` service. |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN` | `pg_dump`, `pg_restore` | The PostgreSQL client tools, at least as new as the server. |

- **Safe to interrupt:** a backup is written as `<name>.partial` and renamed when complete. Rotation runs only after a successful backup and only deletes folders it made.
- **Consistent:** the dump and the file list come from one database snapshot, and files are archived after it, so every row in the dump has its file. A file deleted while the archive runs is reported as a warning (that message shows a broken attachment). Uploads still in progress are left out.
- **Scheduling:** on the complete stack, add `backup` to `COMPOSE_PROFILES` for a service that backs up at start and every `BACKUP_INTERVAL_SECONDS`. Otherwise use the host's cron, for example `0 3 * * * cd /srv/linkord && flock -n .backup.lock docker compose --env-file .env.full exec -T app node server/dist/scripts/backup.js >> backup.log 2>&1`.
- **Off the machine:** a backup on the same disk does not survive that disk. Copy the folder elsewhere after each run (`rclone copy`, `aws s3 sync`, `rsync`; from a compose volume, `docker compose --env-file .env.full cp app:/app/backups ./backups`) and set a lifecycle rule there, since rotation only prunes the local folder.
- **Not in the backup:** the `.env` (database credentials, `LIVEKIT_*` and the Web Push VAPID keys, without which every push subscription breaks) and LiveKit. Keep the `.env` in a secrets store. A backup holds password hashes, sessions and every message: treat it like the database, and encrypt it when it leaves the machine.

### Restoring

1. Install the app with its `.env`, pointing `DATABASE_URL` at a new, empty database and `UPLOAD_DIR` at an empty or missing folder (in Docker, owned by `1000:1000`).
2. Copy the backup folder into `BACKUP_DIR`.
3. With the app stopped, run the restore. The first run only says what it would do; `--confirm` must name the database in `DATABASE_URL`:

```bash
npm run restore -- latest --confirm linkord
# the complete stack (after `docker compose --env-file .env.full stop app`):
docker compose --env-file .env.full run --rm --no-deps app node server/dist/scripts/restore.js latest --confirm linkord
```

4. Start the app. A newer app applies its newer migrations as on any upgrade; an older app cannot read a newer database.

`latest` can be a folder name or a path. The restore refuses, before changing anything, a backup whose checksums do not match its manifest, a missing or wrong `--confirm`, a database that already has tables, and an uploads folder that has files. `pg_restore` runs in one transaction, and files are extracted only after it succeeds. It then compares row counts, migrations and files with the manifest: a mismatch exits 3, warnings exit 0 (3 with `--strict`), other failures 1, a missing confirmation 2.

Rehearsing a restore locally: [DEVELOPMENT.md](DEVELOPMENT.md#backup-scripts-locally).

## One instance only

Run a single container. The server keeps live state in its own memory (who is online and in which call, caches, flood limits, upload reservations), Socket.IO has no shared adapter, and files live on the local disk, so a second instance behind a load balancer would not see the first one's users, calls or limits. What would have to change: [DEVELOPMENT.md](DEVELOPMENT.md#single-instance-assumption).

## Logs

The server writes one JSON line per record to stdout and stderr (`LOG_FORMAT=json`, the production default); keeping them is the container runtime's job. What they hold about people:

- **Client addresses** only on security events: failed or refused logins, refused sign-ups and wrong invite codes, refused login or recovery codes, and refused socket connections past the per-address limit. Routine records (a socket joining, an outdated client) carry none.
- **Failed logins never carry the typed username**, since people type their password there by mistake. A name that matched an account is logged as that account's `userId`; any other as `usernameTag`, a 12-character keyed hash that repeats for the same name until the next restart and cannot be reversed from the log.
- **Browser errors** (`POST /api/client-logs`) are always under the `client` component with the reporting `userId`, or `null` when signed out. A signed-out page can only produce `warn` records (an `error` it sent is kept as `warn` with `reportedLevel: "error"`), so alerts on `error` only see the server and signed-in clients, and control characters in the message are replaced with spaces.

Keep logs for at most **30 days**. The compose file and the `docker run` above rotate them at 5 files of 10 MB, which on a small instance is days to a few weeks; with Dokploy, or any other log collector, set the same bound in its log settings. The addresses stored with each login session (Settings → Security) are database data and follow the session, not this policy.

## Desktop app

The desktop app (`desktop/`, Electron) is a window around one Linkord server: it loads the server's address and talks to it like a browser tab, so the server needs no change for it. Each installer is built for one server, whose address is baked in.

### Building the installer

The app ships for Windows only; there are no macOS or Linux builds.

```bash
npm install --prefix desktop
LINKORD_URL=https://chat.example.com npm run package:desktop
```

The installer lands in `desktop/release/` as `Linkord-<version>-win-x64.exe` (the version is `desktop/package.json`'s). It installs for the current user, with no administrator prompt, and registers `linkord://` links (`HKCU\Software\Classes\linkord`, from `desktop/resources/installer.nsh`); uninstalling removes them. What the links open is in [DEVELOPMENT.md](DEVELOPMENT.md#desktop-app).

- `LINKORD_URL` must be `https` (plain `http` only for `localhost`); the build refuses to run without it. A different server needs its own build. Someone who has the app can still point it elsewhere with `LINKORD_URL` or `--url=<address>` at launch; a start from a `linkord://` link ignores `--url`.
- The build always targets Windows (`--win`). Anything after `--` goes to electron-builder, for example `npm run package:desktop -- --dir` for an unpacked folder. On macOS or Linux electron-builder may need Wine to build it; the workflow below builds it on a Windows runner.

**From GitHub Actions:** run **Desktop installer** (`.github/workflows/desktop.yml`) from the Actions tab with the server's address in `url`. It builds on a Windows runner and uploads the artifact `linkord-desktop-windows`; no secrets are needed, since nothing is signed. Workflow builds look for updates in the repository's releases; a local build does only with `LINKORD_UPDATE_REPO=<owner>/<repo>` set.

### Unsigned installer

The installer has no code signing certificate. It works, but Windows treats it as from an unknown developer: SmartScreen shows "Windows protected your PC", and the person chooses **More info** → **Run anyway**. Each new version shows it again, and some antivirus tools are quicker to flag unsigned programs.

### Electron fuses

The build flips Electron's fuses in `Linkord.exe` (`electronFuses` in `desktop/electron-builder.config.cjs`), so the installed binary cannot be used to run someone else's code under its name:

| Fuse | Value | Effect |
| --- | --- | --- |
| `runAsNode` | off | `ELECTRON_RUN_AS_NODE` does not turn it into a Node interpreter |
| `enableNodeOptionsEnvironmentVariable` | off | `NODE_OPTIONS` is ignored |
| `enableNodeCliInspectArguments` | off | `--inspect` and its kin do not attach a debugger |
| `enableEmbeddedAsarIntegrityValidation` | on | a changed `resources\app.asar` stops the app at start ("Integrity check failed") |
| `onlyLoadAppFromAsar` | on | the app loads only from `app.asar`, never from a loose `app` folder |
| `enableCookieEncryption` | on | the session cookie is encrypted on disk with the Windows user's key (DPAPI) |

- Cookie encryption is one way: a later build with the fuse off could not read the cookies, and everyone would have to sign in again.
- No fuse covers Chromium's remote debugging, so an installed build exits at once when started with `--remote-debugging-port` or `--remote-debugging-pipe` (`desktop/src/main/debugSwitches.ts`).
- To check a build: `npx electron-fuses read --app desktop/release/win-unpacked/Linkord.exe` (from `desktop/`, after `npm run package:desktop -- --dir`).

### Updates and data

The interface comes from the server, so a server deploy updates it; a new installer is needed only for changes in `desktop/`. An older desktop build keeps working, because the web app checks each feature the desktop app offers before using it.

How an installed app updates:

- **At start**, a small window (`desktop/src/main/updaterWindow.ts`) checks for a newer version before the app's window opens. An update found then is downloaded and installed first, with progress shown; the app restarts into the new version. A check that fails, finds nothing or takes more than 8 seconds goes on to connecting (a slow check keeps running and installs in the background). A start with the system that stays in the tray checks in the background.
- **Afterwards** it checks every 6 hours, and on **Check for updates…** in the tray or the menu. A downloaded update shows as a green arrow in the title bar and **Restart to update** in the tray, and installs on that click or when Linkord quits.
- **What counts:** the latest published release of the repository it was built for (`LINKORD_UPDATE_REPO`, set by the workflow to its own repository), only with a higher version number.

No key or secret is involved. The update is checked against the SHA-512 in the release's `latest.yml`, served over HTTPS by GitHub; the release is created with the workflow's own `GITHUB_TOKEN`. Anyone who can publish releases on the repository can therefore ship an update to every installed app, so keep that permission as tight as the deploy itself.

Old macOS and Linux installs (0.3.1 and earlier) keep running, and a newer release only shows them a link to the release page, which has no installer for their system.

To release a version:

1. Raise `version` in `desktop/package.json` (and its `package-lock.json`, `npm version <x.y.z> --prefix desktop --no-git-tag-version`), and push it.
2. Run **Desktop installer** with the server's address and **release** ticked. After the build, a job creates a draft release `v<version>` with the installer and `latest.yml`. It fails if that version already has a release.
3. Check the draft on the repository's Releases page and publish it. Installed apps see nothing until then.

- **Deploy the server first** when a desktop version relies on the page (the title bar is drawn by the web app, for one).
- **Use the same `url` for every release:** the address is baked into the installer, so an update built for another address moves everyone to that server. The updater takes the newest published release, whatever it contains, so keep the repository's releases for the desktop app.
- Set `DESKTOP_RELEASES_REPO=<owner>/<repo>` on the server so the web app offers the installer to people using a browser on Windows ([INTEGRATIONS.md](INTEGRATIONS.md#github-releases)).

The app keeps its session and window state in `%APPDATA%\Linkord`.

## Troubleshooting

- **`/readyz` answers 503.** Search the log for `not ready`: its fields say whether `database` (unreachable, refused, or past the 1 s timeout, which also happens when every pooled connection is busy) or `uploads` (a folder that is not writable, see [Folders and permissions](#folders-and-permissions)) failed.

- **An API call answers 500 with only "Erro interno." and a `requestId`.** The server never sends the cause of an unexpected error to the client (it may contain SQL or file paths). Search the log for that value as `reqId`: the `error in a route` line has the full error and stack. The same id is in the response's `x-request-id` header.

- **Attachments and voice messages fail, profile pictures work.** `POST /api/attachments/init` answers 500 and the log shows `EACCES: permission denied, mkdir '/app/uploads/tmp/…'`. A folder under the uploads mount is still owned by root: see [Folders and permissions](#folders-and-permissions). The 429s that follow are the browser retrying.
- **Backups fail with `EACCES`.** The same, for the folder mounted on `/app/backups`, or nothing is mounted there.
- **Calls connect but nobody hears anyone, on the complete stack.** `LIVEKIT_NODE_IP` is still `127.0.0.1`, or `7881/tcp` and `7882/udp` are closed or published on loopback (`LIVEKIT_RTC_BIND`). See [The complete stack on one server](#the-complete-stack-on-one-server).
- **Calls do not connect, chat works.** Check `LIVEKIT_URL`: it must be the address browsers use, and the browser console names it in a Content-Security-Policy error if the policy blocked it. Without `LIVEKIT_*` the server logs `LiveKit is not configured` at startup.
- **Covers, avatars or link preview pictures are missing.** The server downloads them itself, so the container needs outbound HTTPS to `images.igdb.com`, `cdn.myanimelist.net`, `avatars.githubusercontent.com`, `i.ytimg.com` and the sites people link to. The browser's network tab shows the reason on the `/api/media-proxy/...` request (`502 image_unavailable`, `429 rate_limited`, `415 not_an_image`).
- **"Origem não permitida." (403) on every change, or the socket refuses to connect.** That is the app's own Portuguese error for a request from an origin it does not know. `APP_URL` must match the address in the browser; other addresses go in `ALLOWED_ORIGINS`.
- **Signing in seems to work, but the next page is signed out.** The session cookie is marked `Secure` while the browser uses a plain `http://` address, so the browser drops it. Serve the app over HTTPS, or leave `COOKIE_SECURE=auto` instead of `1`.
- **The server refuses to start** with a message about `PUSH_VAPID_*` or `APP_URL`: Web Push needs all three keys and an HTTPS `APP_URL`.
