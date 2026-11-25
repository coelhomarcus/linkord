# Deployment

How to run Linkord in production, what the container expects from the host, and what to look at when something breaks. For running it on your own machine, see [DEVELOPMENT.md](DEVELOPMENT.md).

## What gets deployed

The [`Dockerfile`](../Dockerfile) builds the app and its profile sync worker. The default `monolith` target serves the web app, API, uploads and Socket.IO on port **3000**. For independent web releases, use the `backend` target on **3000** and the `frontend` target on **8080**. Both app targets that serve the API include the backup scripts and PostgreSQL client tools. In every installation, run `connection-sync` as a separate service with access to the same PostgreSQL database.

- **Health checks:** both public, both answer only `{ ok: … }`.
  - `GET /healthz` (liveness): `200` while the process serves HTTP. The image's `HEALTHCHECK`, Dokploy and the end-to-end stack use it.
  - `GET /readyz` (readiness): `200` when PostgreSQL answers within 1 s and the upload folders are writable, `503` otherwise, cached for 5 s. The log says what failed (`not ready` under the `health` component). Point monitoring at it. The container's health check stays on `/healthz` on purpose: with [one instance](#one-instance-only), restarting the container on a database outage would drop every call and fix nothing.
- **Behind a proxy:** the image sets `TRUST_PROXY=1`. The client address is the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` places from the right (default `1`, one proxy such as Traefik). With a CDN or a second proxy in front, set it to the number of proxies: too low and callers pick their own address and escape the per-IP limits, too high and everyone shares one address. With `COOKIE_SECURE=auto` (the default) the session cookie is `Secure` whenever the proxy says the request was HTTPS.
- **Migrations** run at startup (`MIGRATE_ON_BOOT=1`, the default) before the server accepts connections; if one fails, the process exits with the reason in the log. Set `MIGRATE_ON_BOOT=0` to run them yourself with `bun --no-env-file server/dist/db/migrate.js`.
- **Not root:** the process runs as `bun` (UID/GID 1000). It cannot rewrite its own code and can only write to `/app/uploads` and `/app/backups`, which is why those two folders need the right owner on the host ([Folders and permissions](#folders-and-permissions)).

To roll back a runtime upgrade, redeploy the previous image with the same PostgreSQL, upload and backup volumes.

## Before you start

- **PostgreSQL** 17 is what development and the tests use. The backup tools in the image follow the newest Alpine release and must be at least as new as the server. The migrations create the `unaccent` and `pg_trgm` extensions (message search); both ship with the official images and are trusted, so the user in `DATABASE_URL` needs no superuser rights, only `CREATE` on its database (which the database's owner has). A server without the contrib extensions fails that migration at startup.
- **LiveKit** for voice, video and screen sharing: LiveKit Cloud or a self-hosted server ([INTEGRATIONS.md](INTEGRATIONS.md#livekit)).
- **A domain with HTTPS.** Web Push, the `Secure` cookie, `Strict-Transport-Security` and Chrome's CSP reports all need it.

Start with [`.env.example`](../.env.example) and set the values for your production instance.

| Variable | What to put there |
| --- | --- |
| `DATABASE_URL` | The database the app owns. `DATABASE_SSL=1` when it is reached over TLS. `DATABASE_POOL_MAX` (default 10) is how many connections it keeps open; keep it below the server's `max_connections`. |
| `APP_URL` | The public origin, `https://chat.example.com`, no trailing slash. Used in emails, push, the origin check and the Content-Security-Policy. |
| `REGISTRATION_CODE` | Empty means nobody can sign up. Set a code and share it with the people you invite. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The URL browsers really use to reach LiveKit (`wss://…`). The CSP only lets the browser connect there. |

For optional settings, copy the entries you need from [`.env.optional.example`](../.env.optional.example) and uncomment them. Configure [Resend](INTEGRATIONS.md#resend) for password recovery and two-step login, and [Web Push](INTEGRATIONS.md#web-push) for browser push notifications.

After the first start, make yourself an administrator by running `bun --no-env-file server/dist/scripts/adminRole.js grant <username>` inside the container or `bun run admin:grant <username>` from a checkout.

## Docker on one host

Provision PostgreSQL and LiveKit, then build the app and worker. Start from `.env.example` and set `DATABASE_URL`, the public HTTPS `APP_URL`, and the `LIVEKIT_*` values. The addresses must be reachable from the containers. If PostgreSQL is on a Docker network, attach Linkord to that network with `--network <name>` and use the database service name in `DATABASE_URL`.

```bash
docker build -t linkord .
docker build --target connection-sync -t linkord-connection-sync .
mkdir -p uploads backups
sudo chown -R 1000:1000 uploads backups
docker run -d --name linkord --restart unless-stopped --env-file .env \
  -p 127.0.0.1:3000:3000 -v "$PWD/uploads:/app/uploads" -v "$PWD/backups:/app/backups" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 linkord
```

Start the [profile sync worker](#profile-sync-worker) alongside the app.

Point the entire public HTTPS domain at `127.0.0.1:3000`. The port stays on loopback because the image trusts `X-Forwarded-For`. Send the original host and HTTPS scheme from the proxy and forward WebSocket upgrades.

When migrating an older bundled installation, keep its PostgreSQL data and the upload and backup volumes. Take a [backup](#backups) before switching, then mount those volumes in place of the bind mounts above or restore into the new installation.

## Profile sync worker

The backend applies database migrations and saves profile connections. The worker polls PostgreSQL and refreshes due GitHub, MyAnimeList, Steam and Twitch profiles. A worker outage leaves queued connections pending and existing snapshots available. [Integration and retry behavior](INTEGRATIONS.md#how-connection-syncing-works)

For Docker installs, start the `connection-sync` image from the same revision as the app.

```bash
docker run -d --name linkord-connection-sync --restart unless-stopped \
  --env-file .env linkord-connection-sync
```

If PostgreSQL is on a Docker network, add the same `--network <name>` option used by the backend. Both processes need the same database and TLS settings. Set `MAL_CLIENT_ID` in the worker for MyAnimeList. Set `STEAM_WEB_API_KEY` and the Twitch pair `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` in both processes when those integrations are enabled. The API uses them for connection setup, live status and game search. Budget `DATABASE_POOL_MAX` per process.

The worker uses outgoing connections to PostgreSQL and the providers. It needs no domain, published port or volumes. Inspect the `connection-sync` logs for poll and provider errors. During a redeploy, the worker gets up to eight seconds to complete the connection it already claimed. PostgreSQL lets a new worker retry interrupted work when its lease expires.

When upgrading from a version that synced inside the API, start the worker before updating the backend. Database leases coordinate any overlap during the rollout. If you roll back to an older backend that still syncs, stop the separate worker once the older backend is healthy.

## Routing a split deploy

Point DNS at a reverse proxy serving a single public HTTPS origin, for example `https://chat.example.com`. The browser uses that origin for the page, session cookies, API and Socket.IO. The path determines which service receives the request.

| Public paths | Destination |
| --- | --- |
| `/api`, `/ws` and `/uploads`, including their subpaths | Backend on port `3000` |
| Exactly `/healthz` and `/readyz` | Backend on port `3000` |
| All other paths, including `/`, `/assets/…` and `/sw.js` | Frontend on port `8080` |

Keep both destination ports private. Forward the original `Host`, path and query string, and pass the public HTTPS scheme and client IP through trusted forwarding headers. `/ws` needs both HTTP polling and WebSocket upgrades. Run the proxy independently of the frontend so replacing the static site does not interrupt backend connections.

The frontend image generates its Content Security Policy at build time. Set its `APP_URL` and `LIVEKIT_URL` build arguments to the same public URLs as the backend. Set `KLIPY_ENABLED=1` when the backend has a KLIPY key, and match its `MEDIA_PROXY` and `CSP_REPORT_ONLY` settings if they differ from the defaults (`1` and `0`). Rebuild the frontend when these public settings change. Database and integration credentials belong in the backend's runtime environment.

### Split deploy with Caddy

Provision PostgreSQL and LiveKit, then build the images. Replace the example URLs with the values in the backend's `.env`.

```bash
docker build --target backend -t linkord-backend .
docker build --target connection-sync -t linkord-connection-sync .
docker build --target frontend -t linkord-web \
  --build-arg APP_URL=https://chat.example.com \
  --build-arg LIVEKIT_URL=wss://livekit.example.com .
```

Start the backend with the [standalone `docker run` command](#docker-on-one-host), using `linkord-backend` as the image. Start the [profile sync worker](#profile-sync-worker) alongside it. Start the frontend on loopback too.

```bash
docker run -d --name linkord-web --restart unless-stopped \
  -p 127.0.0.1:8080:8080 linkord-web
```

Use the [example Caddyfile](../docker/web/Caddyfile) with your public hostname. It assumes Caddy terminates HTTPS directly and can reach both published loopback ports. If Caddy runs in Docker, put it on a shared network with both services and replace the loopback destinations with their Docker DNS names and ports. Point DNS at Caddy and allow inbound TCP ports `80` and `443` for [automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## Dokploy

Use three **Applications** in the same project and environment with the GitHub repository root as the build context, branch `main` and Dockerfile `./Dockerfile`. Traefik needs access to the backend and frontend by service name. The backend and the worker both need access to PostgreSQL.

| Application | Docker Build Stage | Port | Watch Paths |
| --- | --- | --- | --- |
| `linkord-backend` | `backend` | `3000` | `server/**`, `package.json`, `bun.lock`, `bunfig.toml`, `Dockerfile`, `.dockerignore` |
| `linkord-web` | `frontend` | `8080` | `web/**`, `docker/web/generate-headers.ts`, `docker/web/nginx.conf`, `server/src/http/pageSecurityPolicy.ts`, `server/src/modules/link-preview/playerHosts.ts`, `Dockerfile`, `.dockerignore` |
| `linkord-connection-sync` | `connection-sync` | None | `server/**`, `package.json`, `bun.lock`, `bunfig.toml`, `Dockerfile`, `.dockerignore` |

Keep one replica of the backend. Its environment holds the database and integration settings above. Keep the existing bind mounts for `/app/uploads` and `/app/backups`. For a new installation, create the source folders on the host as root for uid 1000:

```bash
mkdir -p /srv/linkord/uploads /srv/linkord/backups
chown -R 1000:1000 /srv/linkord/uploads /srv/linkord/backups
```

In `linkord-web`, enter the [frontend build arguments](#routing-a-split-deploy) in **Environment → Build-time Arguments**, one assignment per line. Leave the runtime environment and volume settings empty and keep **Create .env File** off.

In `linkord-connection-sync`, set the database and provider variables in **Environment**. Use one replica and leave **Domains**, **Ports** and **Mounts** empty. For the first worker release on an existing installation, pause Auto Deploy on `linkord-backend` before the revision reaches `main`. Deploy the worker, then deploy the backend and resume Auto Deploy. [Worker rollout and rollback](#profile-sync-worker)

Fill in the [Traefik template](../docker/web/traefik.dokploy.yml) and install it in `linkord-web` under **Advanced → Traefik**.

| Placeholder | Replace with |
| --- | --- |
| `__APP_DOMAIN__` | The hostname from `APP_URL`, such as `chat.example.com` |
| `__BACKEND_APP_NAME__` | The internal Dokploy service name for the `backend` application |
| `__FRONTEND_APP_NAME__` | The internal Dokploy service name for the `frontend` application |

The backend router has higher priority than the frontend's catch-all. The template uses Dokploy's `web` and `websecure` entry points and its `redirect-to-https@file` middleware. Both HTTPS routers inherit TLS from `websecure`. If your installation configures TLS per router, add `tls.certResolver` to both HTTPS routers for a configured certificate resolver, or `tls: {}` to use a certificate already loaded in Traefik. [Traefik TLS settings](https://doc.traefik.io/traefik/reference/routing-configuration/http/tls/overview/)

For a fresh split deploy, leave **Domains** empty on both applications. The installed Traefik file owns routing for the hostname. When migrating an existing monolith, check that its previous catch-all router is disabled after the cutover, even if the old domain record still appears in Dokploy.

The web image sends `private, no-cache, no-store, max-age=0` for `/sw.js` so browsers can check for updates even behind a CDN. Verify that the CDN preserves those directives on the public domain. HTML still uses `no-cache` and versioned assets use immutable caching.

**Migrating a monolith on Dokploy.** Run `bun run --cwd e2e test:split` with Docker and Chrome. Before merging to `main`, pause Auto Deploy on the existing Application and record its deployed commit, build settings and Traefik configuration. Bring up the frontend and add its routing above the existing monolith route. Check HTTPS, a direct link, a signed-in session, `/readyz`, uploads and the socket. Then redeploy the existing Application with the `backend` target. After it is healthy, retire its old catch-all router, verify both route priorities and enable Auto Deploy with the listed Watch Paths.

**Rollback.** Before the backend changes, restoring the previous Traefik configuration puts the monolith back in front immediately. After the switch, restore the old backend route and redeploy the saved commit as the default monolith image on the existing Application. Wait for readiness before removing the split routes. For a frontend-only rollback, point the web Application at a temporary branch at the last working frontend commit, deploy that Application, then restore its `main` source and Watch Paths. The backend remains connected during a frontend-only deploy or rollback.

**Restart policy.** The app relies on being restarted when it exits: an uncaught exception or an unhandled promise rejection is logged as `fatal uncaughtException, shutting down` (or `unhandledRejection`), the server shuts down the same way as for a deploy (calls are restored by the next process) and exits with code 1. The standalone `docker run` command uses `--restart unless-stopped`. On Dokploy, the Swarm service's default restart policy (`condition: any`) already restarts it; if you changed it under the application's Swarm settings, keep the condition at `any` or `on-failure`. To check:

```bash
docker service inspect <app-name> --format '{{json .Spec.TaskTemplate.RestartPolicy}}'
```

Dokploy runs the app as a Swarm service, so the container's name changes with every deploy (`<app-name>.1.<task id>`). Take it from `docker ps` each time you need it:

```bash
docker ps --format '{{.Names}}' | grep <app-name>
```

## Upgrading from a version with playgrounds

Stop the retired playground service's container and remove `PLAYGROUND_URL`, `PLAYGROUND_INTERNAL_URL` and `PLAYGROUND_SECRET` from the app's environment. Migration `0084` removes the playground mode, chat links, stored skins and account deletion queue from the Linkord database. Former playground channels keep their IDs and work as ordinary voice channels.

## Folders and permissions

The app writes to two places and nothing else:

| Container path | What is there |
| --- | --- |
| `/app/uploads` | Every stored file: attachments, thumbnails, profile images, soundboard sounds, server emojis and stickers, and the icons shown with someone's activity, games' and apps' alike (`activity-icons/`). `tmp/` inside it holds the chunks of uploads still in progress, one folder per upload. `exports/` holds the ZIPs of "Download my data" (`EXPORT_DIR`, see below). |
| `/app/backups` | One dated folder per backup (`BACKUP_DIR`). |

**Data exports** (Settings → Data & privacy) are ZIPs of a person's profile, settings, activity, friends, servers, sent messages and their files, written to `EXPORT_DIR` (default `/app/uploads/exports`), downloadable by that account for 7 days and then deleted. Each is about the size of the person's attachments, at most one request per account per day. Keep `EXPORT_DIR` on a mounted volume, or a deploy drops ready files and their links answer 404. Backups leave exports out.

Both must belong to uid 1000 **all the way down**. Docker creates a missing bind-mounted folder owned by root, and older installs that ran as root have root-owned files inside. Always use `chown -R`: with only the top folder fixed, profile pictures still save but every attachment and voice message fails (`tmp/` stays root's).

To see where the folders live on the host and fix them:

```bash
docker inspect <container> --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
chown -R 1000:1000 <each Source path>
```

To check, from inside the container (no restart is needed after a `chown`):

```bash
docker exec <container> sh -c 'id; ls -ld /app/uploads /app/uploads/tmp /app/backups'
```

Every folder listed must belong to UID/GID 1000. When one does not, the server logs `uploads folder is not writable` at startup with the folders it cannot write.

## Updating

On Dokploy, frontend releases replace only the static service. Existing sockets and calls keep their backend connection. Changes touching API or realtime contracts need to work across versions while the two builds deploy independently. A backend release replaces the Bun container while people are connected:

- **Calls continue.** Audio and video flow between the browsers and LiveKit, and the server keeps who is in which call in PostgreSQL, so after the restart it waits `CALL_RESTORE_GRACE_MS` (90 s by default) for everyone to reconnect to the same call.
- **Messages and uploads wait.** A message sent while the server is down is sent again once it is back, and an upload retries for up to 60 seconds of outage.
- **Old tabs** keep running the previous build until they reload. If the new version changed the realtime protocol in a way old tabs cannot handle, they are shown a "reload the page" screen and leave any call they were in. That only happens when a release says so.

See [Restarting the server during a call](DEVELOPMENT.md#restarting-the-server-during-a-call) for how clients recover and how to verify it.

## Security headers

Fastify sets the backend headers. In the split deploy the frontend image generates its own headers from the same policy code and its own build files. The reverse proxy should pass these headers through.

- `Content-Security-Policy`, generated from the public origin, LiveKit URL, integration flags and the frontend build. A wrong `LIVEKIT_URL` blocks calls in the browser even when the server reaches LiveKit. How it is built and how to allow a new host: [DEVELOPMENT.md](DEVELOPMENT.md#content-security-policy).
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`: no other site can frame Linkord.
- `Strict-Transport-Security` (one year, without `includeSubDomains`) on HTTPS requests.

Browsers report violations to `POST /api/csp-reports`, and the server logs them as `content security policy violation`. A proxy or CDN that injects scripts shows up there: Cloudflare's Web Analytics beacon (`static.cloudflareinsights.com`) is blocked, so turn that injection off. `CSP_REPORT_ONLY=1` reports without blocking.

## Backups

The database and the uploads must be backed up together, and the image does it without stopping the app: `bun --no-env-file server/dist/scripts/backup.js` (`bun run backup` from a checkout) writes one folder to `BACKUP_DIR` (`/app/backups` in the image):

```
linkord-backup-20261108T015300Z/
  database.dump     pg_dump, custom format
  uploads.tar.gz    the uploads, without tmp/ and exports/
  manifest.json     row counts, migrations, file counts, SHA-256 of both files
```

```bash
# standalone Docker
docker exec linkord bun --no-env-file server/dist/scripts/backup.js
# Dokploy (from the host)
docker exec $(docker ps -qf name=<app-name>) bun --no-env-file server/dist/scripts/backup.js
```

| Setting | Default | What it does |
| --- | --- | --- |
| `BACKUP_DIR` | `./backups` | Where backups are written and read. Not inside `UPLOAD_DIR`. |
| `BACKUP_KEEP` | `7` | How many backups rotation keeps (at least 1). |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN` | `pg_dump`, `pg_restore` | The PostgreSQL client tools, at least as new as the server. |

- **Safe to interrupt:** a backup is written as `<name>.partial` and renamed when complete. Rotation runs only after a successful backup and only deletes folders it made.
- **Consistent:** the dump and the file list come from one database snapshot, and files are archived after it, so every row in the dump has its file. A file deleted while the archive runs is reported as a warning (that message shows a broken attachment). Uploads still in progress are left out.
- For scheduled backups, run the appropriate `docker exec` command from the host's scheduler.
- Copy completed backups off the host after each run with a tool such as `rclone` or `rsync`. Set retention on the destination too, since rotation prunes only the local backup directory.
- **Not in the backup:** the `.env` (database credentials, `LIVEKIT_*` and the Web Push VAPID keys, without which every push subscription breaks) and LiveKit. Keep the `.env` in a secrets store. A backup holds password hashes, sessions and every message: treat it like the database, and encrypt it when it leaves the machine.

### Restoring

1. Install the app with its `.env`, pointing `DATABASE_URL` at a new, empty database and `UPLOAD_DIR` at an empty or missing folder (in Docker, owned by `1000:1000`).
2. Copy the backup folder into `BACKUP_DIR`.
3. With the app stopped, run the restore. The first run only says what it would do; `--confirm` must name the database in `DATABASE_URL`:

```bash
bun run restore latest --confirm linkord

# standalone Docker, after stopping the app
docker run --rm --env-file .env \
  -v "$PWD/uploads:/app/uploads" -v "$PWD/backups:/app/backups" \
  linkord bun --no-env-file server/dist/scripts/restore.js latest --confirm linkord
```

For Docker, use the same database network settings as the intended Linkord container.

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

Keep logs for at most **30 days**. The standalone `docker run` command rotates them at 5 files of 10 MB, which on a small instance is days to a few weeks; with Dokploy, or any other log collector, set the same bound in its log settings. The addresses stored with each login session (Settings → Security) are database data and follow the session, not this policy.

## Desktop app

The desktop app (`desktop/`, Electron) is a window around one Linkord server: it loads the server's address and talks to it like a browser tab, so the server needs no change for it. Each installer is built for one server, whose address is baked in.

### Building the installer

The app ships for Windows only; there are no macOS or Linux builds.

```bash
npm install --prefix desktop
LINKORD_URL=https://chat.example.com npm run package --prefix desktop
```

The installer lands in `desktop/release/` as `Linkord-<version>-win-x64.exe` (the version is `desktop/package.json`'s). It installs for the current user, with no administrator prompt, and registers `linkord://` links (`HKCU\Software\Classes\linkord`, from `desktop/resources/installer.nsh`); uninstalling removes them. What the links open is in [DEVELOPMENT.md](DEVELOPMENT.md#desktop-app).

- `LINKORD_URL` must be `https` (plain `http` only for `localhost`); the build refuses to run without it. A different server needs its own build. Someone who has the app can still point it elsewhere with `LINKORD_URL` or `--url=<address>` at launch; a start from a `linkord://` link ignores `--url`.
- The build always targets Windows (`--win`). Anything after `--` goes to electron-builder, for example `npm run package --prefix desktop -- --dir` for an unpacked folder. On macOS or Linux electron-builder may need Wine to build it; the workflow below builds it on a Windows runner.

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
- To check a build: `npx electron-fuses read --app desktop/release/win-unpacked/Linkord.exe` (from `desktop/`, after `npm run package --prefix desktop -- --dir`).

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
- **Calls connect but nobody hears anyone.** On a self-hosted LiveKit instance, check the advertised media address and published TCP and UDP ports. See [LiveKit](INTEGRATIONS.md#livekit).
- **Calls do not connect, chat works.** Check `LIVEKIT_URL`: it must be the address browsers use, and the browser console names it in a Content-Security-Policy error if the policy blocked it. Without `LIVEKIT_*` the server logs `LiveKit is not configured` at startup.
- **Covers, avatars or link preview pictures are missing.** The server downloads them itself, so the container needs outbound HTTPS to `images.igdb.com`, `cdn.myanimelist.net`, `avatars.githubusercontent.com`, `i.ytimg.com` and the sites people link to. The browser's network tab shows the reason on the `/api/media-proxy/...` request (`502 image_unavailable`, `429 rate_limited`, `415 not_an_image`).
- **"Origem não permitida." (403) on every change, or the socket refuses to connect.** That is the app's own Portuguese error for a request from an origin it does not know. `APP_URL` must match the address in the browser; other addresses go in `ALLOWED_ORIGINS`.
- **Signing in seems to work, but the next page is signed out.** The session cookie is marked `Secure` while the browser uses a plain `http://` address, so the browser drops it. Serve the app over HTTPS, or leave `COOKIE_SECURE=auto` instead of `1`.
- **The server refuses to start** with a message about `PUSH_VAPID_*` or `APP_URL`: Web Push needs all three keys and an HTTPS `APP_URL`.
