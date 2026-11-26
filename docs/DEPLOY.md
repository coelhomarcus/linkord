# Deployment

How to run Overcord in production, what the container expects from the host, and what to look at when something breaks. For running it on your own machine, see [DEVELOPMENT.md](DEVELOPMENT.md).

## What gets deployed

The [`Dockerfile`](../Dockerfile) builds one image, and production runs one container from it: a single Bun process on port **3000** that serves the web app, the [administration site](#administration-site) on its own domain, the API, uploads and Socket.IO. The image also carries the backup scripts and the PostgreSQL client tools. The application's only outside dependencies are **PostgreSQL** and **LiveKit**. Email, push, GIFs and the other [integrations](INTEGRATIONS.md#overview) are optional APIs set through the environment.

- **Health checks:** both public, both answer only `{ ok: … }`.
  - `GET /healthz` (liveness): `200` while the process serves HTTP. The image's `HEALTHCHECK`, Dokploy and the end-to-end stack use it.
  - `GET /readyz` (readiness): `200` when PostgreSQL answers within 1 s and the upload folders are writable, `503` otherwise, cached for 5 s. The log says what failed (`not ready` under the `health` component). Point monitoring at it. The container's health check stays on `/healthz` on purpose: with [one instance](#one-instance-only), restarting the container on a database outage would drop every call and fix nothing.
- **Behind a proxy:** the image sets `TRUST_PROXY=1`. The client address is the `X-Forwarded-For` entry `TRUSTED_PROXY_HOPS` places from the right (default `1`, one proxy such as Traefik). With a CDN or a second proxy in front, set it to the number of proxies: too low and callers pick their own address and escape the per-IP limits, too high and everyone shares one address. With `COOKIE_SECURE=auto` (the default) the session cookie is `Secure` whenever the proxy says the request was HTTPS.
- **Migrations** run at startup (`MIGRATE_ON_BOOT=1`, the default) before the server accepts connections; if one fails, the process exits with the reason in the log. Set `MIGRATE_ON_BOOT=0` to run them yourself with `bun --no-env-file server/dist/db/migrate.js`.
- **Not root:** the process runs as `bun` (UID/GID 1000). It cannot rewrite its own code and can only write to `/app/uploads`, which is why that folder needs the right owner on the host ([Folders and permissions](#folders-and-permissions)).

To roll back a runtime upgrade, redeploy the previous image with the same PostgreSQL and upload volumes.

## Before you start

- **PostgreSQL** 17 is what development and the tests use. The backup tools in the image follow the newest Alpine release and must be at least as new as the server. The migrations create the `unaccent` and `pg_trgm` extensions (message search); both ship with the official images and are trusted, so the user in `DATABASE_URL` needs no superuser rights, only `CREATE` on its database (which the database's owner has). A server without the contrib extensions fails that migration at startup.
- **LiveKit** for voice, video and screen sharing: LiveKit Cloud or a self-hosted server ([INTEGRATIONS.md](INTEGRATIONS.md#livekit)).
- **A domain with HTTPS.** Web Push, the `Secure` cookie, `Strict-Transport-Security` and Chrome's CSP reports all need it.

Start with [`.env.example`](../.env.example) and set the values for your production instance.

| Variable | What to put there |
| --- | --- |
| `DATABASE_URL` | The database the app owns. `DATABASE_SSL=1` when it is reached over TLS. `DATABASE_POOL_MAX` (default 10) is how many connections it keeps open; keep it below the server's `max_connections`. |
| `APP_URL` | The public origin, `https://chat.example.com`, no trailing slash. Used in emails, push, the origin check and the Content-Security-Policy. |
| `ADMIN_URL` | Optional. The [administration site](#administration-site)'s own HTTPS origin, such as `https://admin.example.com`. Unset, the admin site and its API are off. |
| `REGISTRATION_CODE` | Empty means nobody can sign up. Set a code and share it with the people you invite. |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The URL browsers really use to reach LiveKit (`wss://…`). The CSP only lets the browser connect there. |

For optional settings, copy the entries you need from [`.env.optional.example`](../.env.optional.example) and uncomment them. Configure [Resend](INTEGRATIONS.md#resend) for password recovery and two-step login, and [Web Push](INTEGRATIONS.md#web-push) for browser push notifications.

After the first start, make yourself an administrator by running `bun --no-env-file server/dist/scripts/adminRole.js grant <username>` inside the container or `bun run admin:grant <username>` from a checkout.

## The image on its own

Provision PostgreSQL and LiveKit, then build the image and run it behind a TLS reverse proxy. Start from `.env.example` and set `DATABASE_URL`, the public HTTPS `APP_URL`, `ADMIN_URL` if you want the admin site, and the `LIVEKIT_*` values. The addresses must be reachable from the container. If PostgreSQL is on a Docker network, attach Overcord to that network with `--network <name>` and use the database service name in `DATABASE_URL`.

```bash
docker build -t overcord .
mkdir -p uploads
sudo chown -R 1000:1000 uploads
docker run -d --name overcord --restart unless-stopped --env-file .env \
  -p 127.0.0.1:3000:3000 -v "$PWD/uploads:/app/uploads" \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --log-opt max-size=10m --log-opt max-file=5 overcord
```

Point the public HTTPS domain, and the admin domain when `ADMIN_URL` is set, at `127.0.0.1:3000`. The [example Caddyfile](../docker/Caddyfile) does that for both hostnames. The port stays on loopback because the image trusts `X-Forwarded-For`. Send the original `Host` and HTTPS scheme from the proxy, since the process picks the admin site by `Host`, and forward WebSocket upgrades.

When migrating an older bundled installation, keep its PostgreSQL data and the upload volume. Take a [backup](#backups) before switching, then mount those volumes in place of the bind mount above or restore into the new installation.

## Administration site

With `ADMIN_URL` set, the same process answers that host with the administration site's build (`admin/dist`) and its own Content-Security-Policy. On that host it reaches only `/api/admin/*`, `/api/csp-reports`, `/uploads/` (profile and server images) and the health checks. Everything else answers `404`, including the public API, `/ws` and `/sw.js`. The public host answers `404` for `/admin`, its subpaths and `/api/admin/*`.

`ADMIN_URL` must be a different origin from `APP_URL` and use HTTPS (plain HTTP only on loopback). The admin session lasts up to 12 hours, uses the account's existing two-step setting and is revocable from its session list. Chat and voice moderation still run in the main app.

To check, the admin domain's `/api/admin/auth/me` answers `401` before login, the public domain answers `404` for `/admin` and `/api/admin/users`, and an active admin can sign in and out.

## Dokploy

Use one **Application** with the GitHub repository root as the build context, branch `main`, Dockerfile `./Dockerfile`, no build stage and no build arguments. Under **Domains**, add the `APP_URL` hostname and the `ADMIN_URL` hostname, both on port `3000` with HTTPS. Domains are the only routing the Application needs; see the warning in [Migrating from the split deploy](#migrating-from-the-split-deploy) before touching Traefik files. Every file in the repository can change the image, so leave **Watch Paths** empty.

Keep one replica. Its environment holds the settings above. Mount `/app/uploads` from the host, and keep an existing `LIVEKIT_ROOM_NAME` value so active calls can reconnect across deploys. For a new installation, create the source folder on the host as root for uid 1000:

```bash
mkdir -p /srv/overcord/uploads
chown -R 1000:1000 /srv/overcord/uploads
```

Installations from before downloaded backups also mounted `/app/backups`. The app no longer writes there: copy off the backup folders you still want (they [restore](#restoring) as they are), then remove that mount.

Overcord sends `private, no-cache, no-store, max-age=0` for `/sw.js` so browsers can check for updates even behind a CDN. Verify that a CDN in front preserves those directives. HTML uses `no-cache` and versioned assets use immutable caching.

**Restart policy.** The app relies on being restarted when it exits: an uncaught exception or an unhandled promise rejection is logged as `fatal uncaughtException, shutting down` (or `unhandledRejection`), the server shuts down the same way as for a deploy (calls are restored by the next process) and exits with code 1. The standalone `docker run` command uses `--restart unless-stopped`. On Dokploy, the Swarm service's default restart policy (`condition: any`) already restarts it; if you changed it under the application's Swarm settings, keep the condition at `any` or `on-failure`. To check:

```bash
docker service inspect <app-name> --format '{{json .Spec.TaskTemplate.RestartPolicy}}'
```

Dokploy runs the app as a Swarm service, so the container's name changes with every deploy (`<app-name>.1.<task id>`). Take it from `docker ps` each time you need it:

```bash
docker ps --format '{{.Names}}' | grep <app-name>
```

### Migrating from the split deploy

Earlier releases ran three Applications: `overcord-backend` (the `backend` target), `overcord-web` (`frontend`) and `overcord-admin` (`admin`). Their path routing lived outside **Domains**, in a Traefik file on `overcord-web` and in Swarm labels (**Advanced → Swarm Settings → Labels**) on both static Applications. `overcord-backend` becomes the single Application. It keeps its environment, volumes and replica, so sessions, uploads and calls carry over.

1. Take a [backup](#backups). Pause Auto Deploy on all three Applications and write down each one's deployed commit, build stage, Traefik file and Swarm labels.
2. In `overcord-backend`, clear **Docker Build Stage** and **Watch Paths**, check that `ADMIN_URL` is the admin site's origin, and deploy the new revision. The current routes still send it only `/api`, `/ws`, `/uploads` and the health checks, so nothing visible changes yet. Wait for `/readyz`.
3. Add the `ADMIN_URL` hostname under the backend's **Domains**, next to the `APP_URL` one. The old routers keep a higher priority, so traffic does not move yet.
4. Stop `overcord-web` and `overcord-admin`. Their labelled routers go away with their tasks, and both hostnames fall through to the backend's Domains. Check HTTPS, a direct link such as `/app/friends`, a signed-in session, an upload, the socket, a call, and the [admin site checks](#administration-site). Then delete both Applications, which also removes their Traefik files, and turn Auto Deploy back on for `overcord-backend`.

Route only through **Domains**. Do not edit or empty Traefik files by hand: Traefik refuses a file with an empty `routers` map, and one invalid file makes it drop every file in `/etc/dokploy/traefik/dynamic`, which takes down every site on the server, the Dokploy panel included. If a change does not seem to apply, read `docker logs --tail 60 dokploy-traefik` before reloading Traefik.

**Rollback.** Before step 4 nothing has moved. After it, start the two stopped Applications again and redeploy the backend from the recorded commit with the `backend` build stage.

## Upgrading from a version with playgrounds

Stop the retired playground service's container and remove `PLAYGROUND_URL`, `PLAYGROUND_INTERNAL_URL` and `PLAYGROUND_SECRET` from the app's environment. Migration `0084` removes the playground mode, chat links, stored skins and account deletion queue from the Overcord database. Former playground channels keep their IDs and work as ordinary voice channels.

## Folders and permissions

The app writes to one place and nothing else:

| Container path | What is there |
| --- | --- |
| `/app/uploads` | Every stored file: attachments, thumbnails, profile images, soundboard sounds, server emojis and stickers, and the icons shown with someone's activity, games' and apps' alike (`activity-icons/`). `tmp/` inside it holds the chunks of uploads still in progress, one folder per upload. `exports/` holds the ZIPs of "Download my data" (`EXPORT_DIR`, see below). |

**Data exports** (Settings → Data & privacy) are ZIPs of a person's profile, settings, activity, friends, servers, sent messages and their files, written to `EXPORT_DIR` (default `/app/uploads/exports`), downloadable by that account for 7 days and then deleted. Each is about the size of the person's attachments, at most one request per account per day. Keep `EXPORT_DIR` on a mounted volume, or a deploy drops ready files and their links answer 404. Backups leave exports out.

It must belong to uid 1000 **all the way down**. Docker creates a missing bind-mounted folder owned by root, and older installs that ran as root have root-owned files inside. Always use `chown -R`: with only the top folder fixed, profile pictures still save but every attachment and voice message fails (`tmp/` stays root's).

To see where the folders live on the host and fix them:

```bash
docker inspect <container> --format '{{range .Mounts}}{{.Type}} {{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'
chown -R 1000:1000 <each Source path>
```

To check, from inside the container (no restart is needed after a `chown`):

```bash
docker exec <container> sh -c 'id; ls -ld /app/uploads /app/uploads/tmp'
```

Every folder listed must belong to UID/GID 1000. When one does not, the server logs `uploads folder is not writable` at startup with the folders it cannot write.

## Updating

Every release replaces the one Bun container while people are connected:

- **Calls continue.** Audio and video flow between the browsers and LiveKit, and the server keeps who is in which call in PostgreSQL, so after the restart it waits `CALL_RESTORE_GRACE_MS` (90 s by default) for everyone to reconnect to the same call.
- **Messages and uploads wait.** A message sent while the server is down is sent again once it is back, and an upload retries for up to 60 seconds of outage.
- **Old tabs** keep running the previous build until they reload. If the new version changed the realtime protocol in a way old tabs cannot handle, they are shown a "reload the page" screen and leave any call they were in. That only happens when a release says so.

See [Restarting the server during a call](DEVELOPMENT.md#restarting-the-server-during-a-call) for how clients recover and how to verify it.

## Security headers

Fastify sets every header at runtime, with a separate policy for the [administration site](#administration-site). The reverse proxy should pass these headers through.

- `Content-Security-Policy`, generated from the public origin, LiveKit URL, integration flags and the web build. A wrong `LIVEKIT_URL` blocks calls in the browser even when the server reaches LiveKit. How it is built and how to allow a new host: [DEVELOPMENT.md](DEVELOPMENT.md#content-security-policy).
- `X-Frame-Options: DENY` and `frame-ancestors 'none'`: no other site can frame Overcord.
- `Strict-Transport-Security` (one year, without `includeSubDomains`) on HTTPS requests.

Browsers report violations to `POST /api/csp-reports`, and the server logs them as `content security policy violation`. A proxy or CDN that injects scripts shows up there: Cloudflare's Web Analytics beacon (`static.cloudflareinsights.com`) is blocked, so turn that injection off. `CSP_REPORT_ONLY=1` reports without blocking.

## Backups

A backup is one ZIP with the database and every stored file, taken without stopping the app. The server never keeps one: it writes the ZIP straight to whoever asked for it, so it needs no free disk space for it and there is nothing on the host to rotate or clean up.

```
overcord-backup-20261126T153000Z.zip
  README.txt       what it is and how to restore it
  database.dump    pg_dump, custom format
  uploads/         every stored file, without tmp/ and exports/
  manifest.json    row counts, migrations, file counts and checksums
```

From the [administration site](#administration-site), **Backup** downloads it in the browser. It asks for a reason and records the download in the audit log (`system.backup_download`) before the first byte leaves; a download that fails or is cancelled gets a second, failed entry. The page shows the expected size and the latest downloads. One backup runs at a time, and a deploy during a download cancels it.

From the command line, the image writes it to stdout, so the host saves it directly:

```bash
# standalone Docker
docker exec overcord bun --no-env-file server/dist/scripts/backup.js > overcord-backup.zip
# Dokploy (from the host)
docker exec $(docker ps -qf name=<app-name>) bun --no-env-file server/dist/scripts/backup.js > overcord-backup-$(date -u +%Y%m%dT%H%M%SZ).zip
```

From a checkout, `bun run backup --out <file or folder>` writes it to a file instead (named by the UTC time when `--out` is a folder). The file is written as `<name>.partial` and renamed when complete, and never replaces an existing one.

| Setting | Default | What it does |
| --- | --- | --- |
| `PG_DUMP_BIN`, `PG_RESTORE_BIN` | `pg_dump`, `pg_restore` | The PostgreSQL client tools, at least as new as the server. |

- **Consistent:** the dump and the list of files the database points at come from one snapshot, and the files are added after the dump, so every row in the dump has its file. A file deleted in between is left out and counted in the manifest (its message shows a broken attachment). Uploads still in progress (`tmp/`) and data exports (`EXPORT_DIR`, and `exports/` by name) are left out.
- **Size:** about the database plus the uploads. Nothing is recompressed: the dump already is, and media files are.
- **Interrupted:** a cancelled download or a failure ends the transfer as failed, never as a ZIP that looks complete.
- For scheduled backups, run the `docker exec` command from the host's scheduler and send the file off the host with a tool such as `rclone` or `rsync`. Keep the retention you want at the destination.
- **Not in the backup:** the `.env` (database credentials, `LIVEKIT_*` and the Web Push VAPID keys, without which every push subscription breaks) and LiveKit. Keep the `.env` in a secrets store. A backup holds password hashes, sessions and every message: treat it like the database, and encrypt it when it leaves the machine. Its checksums catch a damaged file, not a deliberate change, and a restore runs the dump's SQL as the `DATABASE_URL` user: only restore a backup you kept yourself.

### Restoring

1. Install the app with its `.env`, pointing `DATABASE_URL` at a new, empty database and `UPLOAD_DIR` at an empty or missing folder (in Docker, owned by `1000:1000`).
2. With the app stopped, run the restore on the ZIP. The first run only says what it would do; `--confirm` must name the database in `DATABASE_URL`:

```bash
bun run restore overcord-backup.zip --confirm overcord

# standalone Docker, after stopping the app
docker run --rm --env-file .env \
  -v "$PWD/uploads:/app/uploads" -v "$PWD/overcord-backup.zip:/tmp/backup.zip:ro" \
  overcord bun --no-env-file server/dist/scripts/restore.js /tmp/backup.zip --confirm overcord
```

For Docker, use the same database network settings as the intended Overcord container.

3. Start the app. A newer app applies its newer migrations as on any upgrade; an older app cannot read a newer database.

The restore refuses, before changing anything, a backup whose checksums do not match its manifest (every byte of the dump and of the files is checked), a ZIP that holds a name twice, a missing or wrong `--confirm`, a database that already has tables, and an uploads folder that has files. `pg_restore` runs in one transaction and gets the dump checked again as it reads it, so a file that changed after the check is never committed. Files are extracted only after it succeeds. It then compares row counts, migrations and files with the manifest: a mismatch exits 3, warnings exit 0 (3 with `--strict`), other failures 1, a missing confirmation 2.

A backup folder written by an older version (`database.dump`, `uploads.tar.gz`, `manifest.json`) restores the same way, given the folder's path instead of a ZIP.

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

The desktop app (`desktop/`, Electron) is a window around one Overcord server: it loads the server's address and talks to it like a browser tab, so the server needs no change for it. Each installer is built for one server, whose address is baked in.

### Building the installer

The app ships for Windows only; there are no macOS or Linux builds.

```bash
npm install --prefix desktop
OVERCORD_URL=https://chat.example.com npm run package --prefix desktop
```

The installer lands in `desktop/release/` as `Overcord-<version>-win-x64.exe` (the version is `desktop/package.json`'s). It installs for the current user, with no administrator prompt, and registers `overcord://` links (`HKCU\Software\Classes\overcord`, from `desktop/resources/installer.nsh`); uninstalling removes them. What the links open is in [DEVELOPMENT.md](DEVELOPMENT.md#desktop-app).

- `OVERCORD_URL` must be `https` (plain `http` only for `localhost`); the build refuses to run without it. A different server needs its own build. Someone who has the app can still point it elsewhere with `OVERCORD_URL` or `--url=<address>` at launch; a start from a `overcord://` link ignores `--url`.
- The build always targets Windows (`--win`). Anything after `--` goes to electron-builder, for example `npm run package --prefix desktop -- --dir` for an unpacked folder. On macOS or Linux electron-builder may need Wine to build it; the workflow below builds it on a Windows runner.

**From GitHub Actions:** run **Desktop installer** (`.github/workflows/desktop.yml`) from the Actions tab with the server's address in `url`. It builds on a Windows runner and uploads the artifact `overcord-desktop-windows`; no secrets are needed, since nothing is signed. Workflow builds look for updates in the repository's releases; a local build does only with `OVERCORD_UPDATE_REPO=<owner>/<repo>` set.

### Unsigned installer

The installer has no code signing certificate. It works, but Windows treats it as from an unknown developer: SmartScreen shows "Windows protected your PC", and the person chooses **More info** → **Run anyway**. Each new version shows it again, and some antivirus tools are quicker to flag unsigned programs.

### Electron fuses

The build flips Electron's fuses in `Overcord.exe` (`electronFuses` in `desktop/electron-builder.config.cjs`), so the installed binary cannot be used to run someone else's code under its name:

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
- To check a build: `npx electron-fuses read --app desktop/release/win-unpacked/Overcord.exe` (from `desktop/`, after `npm run package --prefix desktop -- --dir`).

### Updates and data

Overcord is a separate Windows installation. If you installed Linkord, uninstall it and install Overcord from [GitHub Releases](https://github.com/coelhomarcus/overcord/releases). Sign in with your existing account at `https://overcord.app`. Your account data stays on the server. Overcord starts with a new local profile.

The interface comes from the server, so a server deploy updates it. Changes to the desktop itself need a new installer.

How an installed app updates:

- **At start**, a small window (`desktop/src/main/updaterWindow.ts`) checks for a newer version before the app's window opens. An update found then is downloaded and installed first, with progress shown; the app restarts into the new version. A check that fails, finds nothing or takes more than 8 seconds goes on to connecting (a slow check keeps running and installs in the background). A start with the system that stays in the tray checks in the background.
- **Afterwards** it checks every 6 hours, and on **Check for updates…** in the tray or the menu. A downloaded update shows as a green arrow in the title bar and **Restart to update** in the tray, and installs on that click or when Overcord quits.
- **What counts:** the latest published release of the repository it was built for (`OVERCORD_UPDATE_REPO`, set by the workflow to its own repository), with `overcord.yml` and a higher version number.

GitHub supplies `GITHUB_TOKEN` to the workflow, which uses it to create the draft. No repository secret or variable is required. The Overcord updater checks the installer's SHA-512 against `overcord.yml`. The previous desktop looks for `latest.yml`, which is excluded from Overcord releases. Limit who can publish releases, since that permission also lets people ship desktop updates.

To release a version:

1. Raise `version` in `desktop/package.json` (and its `package-lock.json`, `npm version <x.y.z> --prefix desktop --no-git-tag-version`), and push it.
2. Run **Desktop installer** with `https://overcord.app` for the official build and **release** ticked. After the build, a job creates a draft release `v<version>` with the installer and `overcord.yml`. It fails if that version already has a release.
3. Check the draft on the repository's Releases page and publish it. Installed apps see nothing until then.

- **Deploy the server first** when a desktop version relies on the page (the title bar is drawn by the web app, for one).
- **Use the same `url` for every release:** the address is baked into the installer, so an update built for another address moves everyone to that server. The updater takes the newest published release, whatever it contains, so keep the repository's releases for the desktop app.
- Set `DESKTOP_RELEASES_REPO=<owner>/<repo>` on the server so the web app offers the installer to people using a browser on Windows ([INTEGRATIONS.md](INTEGRATIONS.md#github-releases)).

The app keeps its session and window state in `%APPDATA%\Overcord`.

## Troubleshooting

- **`/readyz` answers 503.** Search the log for `not ready`: its fields say whether `database` (unreachable, refused, or past the 1 s timeout, which also happens when every pooled connection is busy) or `uploads` (a folder that is not writable, see [Folders and permissions](#folders-and-permissions)) failed.

- **An API call answers 500 with only "Erro interno." and a `requestId`.** The server never sends the cause of an unexpected error to the client (it may contain SQL or file paths). Search the log for that value as `reqId`: the `error in a route` line has the full error and stack. The same id is in the response's `x-request-id` header.

- **Attachments and voice messages fail, profile pictures work.** `POST /api/attachments/init` answers 500 and the log shows `EACCES: permission denied, mkdir '/app/uploads/tmp/…'`. A folder under the uploads mount is still owned by root: see [Folders and permissions](#folders-and-permissions). The 429s that follow are the browser retrying.
- **Calls connect but nobody hears anyone.** On a self-hosted LiveKit instance, check the advertised media address and published TCP and UDP ports. See [LiveKit](INTEGRATIONS.md#livekit).
- **Calls do not connect, chat works.** Check `LIVEKIT_URL`: it must be the address browsers use, and the browser console names it in a Content-Security-Policy error if the policy blocked it. Without `LIVEKIT_*` the server logs `LiveKit is not configured` at startup.
- **Covers, avatars or link preview pictures are missing.** The server downloads them itself, so the container needs outbound HTTPS to `images.igdb.com`, `cdn.myanimelist.net`, `avatars.githubusercontent.com`, `i.ytimg.com` and the sites people link to. The browser's network tab shows the reason on the `/api/media-proxy/...` request (`502 image_unavailable`, `429 rate_limited`, `415 not_an_image`).
- **"Origem não permitida." (403) on every change, or the socket refuses to connect.** That is the app's own Portuguese error for a request from an origin it does not know. `APP_URL` must match the address in the browser; other addresses go in `ALLOWED_ORIGINS`.
- **Signing in seems to work, but the next page is signed out.** The session cookie is marked `Secure` while the browser uses a plain `http://` address, so the browser drops it. Serve the app over HTTPS, or leave `COOKIE_SECURE=auto` instead of `1`.
- **The server refuses to start** with a message about `PUSH_VAPID_*` or `APP_URL`: Web Push needs all three keys and an HTTPS `APP_URL`.
