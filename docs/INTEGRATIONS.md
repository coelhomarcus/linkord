# Third-party integrations

Every external service Linkord talks to, what it is used for, who makes the call (our server or the user's browser), the credentials it needs, and what happens when it is missing or fails. For setup steps see [DEVELOPMENT.md](DEVELOPMENT.md); environment variables are listed in [`.env.example`](../.env.example).

## Overview

| Service | Purpose | Called from | Credentials | Required |
| --- | --- | --- | --- | --- |
| [LiveKit](#livekit) | Voice, video and screen sharing | Server (SDK) and browser | `LIVEKIT_*` | For calls |
| [Resend](#resend) | Account recovery, email-change and two-step login codes | Server | `RESEND_*` | For email flows and two-step login |
| [Web Push](#web-push) | Browser push notifications | Server | `PUSH_VAPID_*` | No |
| [KLIPY](#klipy) | GIF picker | Browser | `KLIPY_API_KEY` | No |
| [MyAnimeList](#myanimelist) | Profile Wall widget | Server (background worker; covers through the [media proxy](#media-proxy)) | `MAL_CLIENT_ID` | No |
| [GitHub](#github) | Profile Wall widgets | Server (background worker; avatar through the [media proxy](#media-proxy)) | None | No |
| [IGDB](#igdb) | Game search for the Wall's games widgets | Server (on demand; covers through the [media proxy](#media-proxy)) | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | No |
| [Arbitrary websites](#link-previews) | Link preview cards | Server (pages, and their images through the [media proxy](#media-proxy)) | None | Built in |
| [YouTube and Twitch](#embedded-players) | Inline players for pasted links | Browser (players); server (YouTube thumbnails, through the [media proxy](#media-proxy)) | None | Built in |

"Server" means the Node process in `server/`; "browser" means the web client in `web/`. The pictures these services provide (covers, avatars, preview images, favicons, YouTube thumbnails) reach the browser through our own [media proxy](#media-proxy), so they show on networks that block those domains. Apart from that, where a service is called from the browser the server does not proxy the traffic.

Two things are deliberately **not** third-party calls: fonts are bundled with `@fontsource-variable/figtree` (no font CDN), and [webhooks](WEBHOOK.md) are inbound requests from other systems into Linkord, not calls we make.

## LiveKit

Selective forwarding unit (SFU) behind every voice channel and 1:1 call.

- **Code:** [`server/src/integrations/livekit/livekit.ts`](../server/src/integrations/livekit/livekit.ts), plus the `call-token` message in `server/src/realtime/socket.ts`. The browser uses `livekit-client`.
- **Server → LiveKit:** `livekit-server-sdk` signs a short-lived access token per call (`createToken`, lifetime `LIVEKIT_TOKEN_TTL_SECONDS`, default 300) scoped to one room named `${LIVEKIT_ROOM_NAME}-${conversationId}`. In a voice channel the grant lists only the sources the member's channel permissions allow (`SPEAK`: microphone; `STREAM`: camera, screen share and its audio), so the SFU itself refuses the rest; a DM call allows all of them. When a role, overwrite, channel or ownership change alters those permissions mid-call, `enforceCallPermissions` (`server/src/modules/calls/callPermissions.ts`) calls `updateParticipant` with the new sources (LiveKit unpublishes what is no longer allowed), or removes the member from the call if they lost `CONNECT`. When membership is revoked, `RoomServiceClient` lists and removes the account's participants (`evictFromCall`, three attempts with backoff). Failures are logged and never roll back the database change.
- **Browser → LiveKit:** a voice channel still joins immediately: `call-join` returns `livekitUrl` and a token, and the client connects to LiveKit directly. A direct conversation does not. `call-join` on a DM is refused. The caller rings with `dm-call-start`; the token is minted for both people only after `dm-call-accept`, on the tab that started the call and the tab that accepted it. The API key and secret never leave the server. Camera and screen share are published separately (`web/src/features/calls/videoPublish.ts`). The camera captures at an ideal 1080p30 — the browser negotiates down when the webcam cannot — and simulcasts 30 fps layers (360p floor, 720p, then the full capture capped at 3 Mbps) with degradation set to keep resolution. Screen share stays a single layer at the selected preset: 1440p60 / 6 Mbps, 1440p30 / 5 Mbps, 1080p60 / 5 Mbps, or 1080p30 / 4.5 Mbps (the default). The 60 fps presets hint `motion` and keep frame rate; the 30 fps ones hint `text` and keep resolution. The room enables adaptive stream at the display's pixel density and dynacast, so a viewer receives the camera layer that fits the tile and the publisher stops sending layers nobody is watching.
- **Restarts:** media flows between the browsers and LiveKit, so a deploy does not cut it. The server keeps who is in which call in Postgres and restores it on boot, holding each connection for `CALL_RESTORE_GRACE_MS` (default 90 s) while its client reconnects under the same LiveKit identity. How that works, and the rules that keep it working, are in `AGENTS.md` ("Realtime compatibility and deploys").
- **Configuration:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_ROOM_NAME`, `LIVEKIT_TOKEN_TTL_SECONDS`, `CALL_RESTORE_GRACE_MS`. `LIVEKIT_URL` is also what the Content-Security-Policy lets the browser connect to (over ws and http; any `*.livekit.cloud` host for LiveKit Cloud), so it must be the URL clients really use.
- **When missing:** the server boots and logs `LiveKit is not configured`; calls, camera and screen sharing fail.

## Resend

Transactional email. Used only for one-time 6-digit codes: password recovery, email changes, turning on two-step login, and the second step of a login when the account has two-step login on.

- **Code:** [`server/src/modules/auth/email.ts`](../server/src/modules/auth/email.ts) — one `POST https://api.resend.com/emails` with a bearer token. The text is localized to the account's language. Codes are issued and checked in `server/src/modules/auth/codes.ts` (only their sha256 is stored): recovery, email-change and setup codes last 30 minutes, a login code 10 minutes, and each allows 5 tries. Wrong codes also count against the account in the Postgres attempt counters (`ratelimit.ts`), so resending does not buy more guesses; code emails themselves are capped at 5 per 15 minutes per account and purpose.
- **Data sent:** the recipient address, the code, the username and `APP_URL`.
- **Configuration:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`. `RESEND_API_URL` (default `https://api.resend.com`) is changed only by the end-to-end stack, which points it at a local mail sink.
- **When missing:** requesting a code fails with `email_not_configured`, and two-step login cannot be turned on (Settings → Security explains why). If Resend rejects the send, the request fails with a 503 `email_delivery_failed`.
- **Two-step login depends on it:** an account that already has two-step login on cannot finish a login while email is down or unconfigured (the login answers 503 `email_unavailable`; the code step is never skipped). Removing the `RESEND_*` variables therefore locks those accounts out until they are restored.

## Web Push

Browser push notifications, delivered through each browser vendor's push service using the standard Web Push protocol with VAPID authentication.

- **Code:** [`server/src/modules/notifications/webPush.ts`](../server/src/modules/notifications/webPush.ts) (`web-push` library) and `web/src/shared/pushNotifications.ts` (service worker and `pushManager` subscription).
- **Destinations:** the subscription endpoint comes from the browser through an authenticated API, so it is validated before the server makes any outbound request. Only HTTPS endpoints without a custom port or credentials on these hosts are accepted: `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com` and `*.notify.windows.com`. Keys must also have the exact lengths a real subscription has.
- **Content:** the title and body are built from the recipient's `users.locale` (`pushNotices.ts`; texts in `localeText.ts`) and never repeat the app name, which the OS already shows. A DM names the sender once, in the title; a channel message is titled `#channel · Server` with `Name: text` as the body; a mention says who, where and what (`Ana in #general · Server`, or `Ana mentioned you` in a DM); friend requests and acceptances name the person; a server invitation is titled with the server and names the inviter. Message text is cut to 120 characters. An account can turn off "Show message text" (`users.push_show_content`, `GET`/`PATCH /api/notifications/push/preferences`): the server then leaves the text out, so a DM reads `Sent a message` and a channel message `Ana sent a message`, and a mention keeps its title with an empty body. Everything else stays the same.
- **Bursts:** every chat message in a conversation shares the tag `chat-<conversation>`, so a new one replaces the one on screen. The payload carries `renotify: true` so each still alerts; the browser shows only the latest text.
- **Sender avatar:** the payload adds `avatar` (an own `/uploads/<id>` path, the still frame of an animated avatar when there is one) next to the app `icon`. Uploads need the session cookie, so `web/public/sw.js` fetches the image itself and inlines it as the notification icon (2.5 s timeout, 300 KB cap), falling back to the app icon on any failure. External avatar URLs are never used. The iOS declarative format ignores `avatar` and `renotify` and always shows the app icon.
- **Delivery:** payloads use `aes128gcm`; the TTL is one hour for chat messages and 24 hours for everything else. Delivery honors the service's `Retry-After` and is driven by the notification outbox worker.
- **Configuration:** `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY` and `PUSH_VAPID_SUBJECT`. They must be set **together** — setting only some makes the server refuse to start. Generate them with `npx web-push generate-vapid-keys`. In production `APP_URL` must use HTTPS.
- **Do not disturb:** a recipient whose `users.presence_status` is `dnd` at delivery time gets no push (`recipientAcceptsPush` in `notificationsPolicy.ts`). The event is marked processed, not postponed: the notification stays in the in-app list, and nothing piles up for the moment the status changes back.
- **When missing:** push is simply unavailable (`pushAvailable` is false) and nothing is sent.

## KLIPY

GIF search and trending in the message composer.

- **Code:** [`web/src/features/gifs/klipy.ts`](../web/src/features/gifs/klipy.ts) calls `https://api.klipy.com/api/v1`; the server side is [`server/src/modules/gifs/gifs.ts`](../server/src/modules/gifs/gifs.ts).
- **Browser only, on purpose:** KLIPY's terms require requests and media loads to come from the user's own client. The server therefore does not proxy anything, GIFs included (they stay out of the [media proxy](#media-proxy)); `GET /api/gifs/config` hands the key to signed-in users (`Cache-Control: no-store`) so it stays out of the bundle and the repository.
- **Data sent:** KLIPY keys its "recent GIFs" and analytics by a customer ID. We send `sha256("klipy:" + userId)` truncated to 32 characters — stable per user, but not our real account ID.
- **Configuration:** `KLIPY_API_KEY`. When it is set, the Content-Security-Policy lets the browser connect to `https://api.klipy.com`; the GIFs themselves load from `static*.klipy.com` under the policy's general `https:` image and media sources.
- **When missing:** the config endpoint reports `enabled: false` and the GIF button is hidden.

## MyAnimeList

The "Recent anime activity" widget on a user's Wall.

- **Code:** [`server/src/integrations/myanimelist/myanimelist.ts`](../server/src/integrations/myanimelist/myanimelist.ts).
- **API:** the official v2 API, `GET https://api.myanimelist.net/v2/users/{username}/animelist` sorted by `list_updated_at`, limited to 8 entries, with the `X-MAL-CLIENT-ID` header. Public lists need only an application client ID, not a user login. Cover images are accepted only from `cdn.myanimelist.net`; the browser loads them through the [media proxy](#media-proxy), so the CDN sees the server, not the viewer.
- **Limits of the API:** it has no favorites or characters endpoint, so recent activity is the only MyAnimeList widget.
- **Configuration:** register an app at <https://myanimelist.net/apiconfig> and set `MAL_CLIENT_ID`.
- **When missing:** MyAnimeList connections report `unavailable` and retry with backoff; the rest of the app is unaffected.
- **Data sent:** the username the account owner typed (self-declared, ownership is not verified).

## GitHub

The "GitHub profile" and "Contributions" widgets.

- **Code:** [`server/src/integrations/github/github.ts`](../server/src/integrations/github/github.ts).
- **Requests per sync:** two, both unauthenticated and sent with `User-Agent: Linkord`.
  1. `GET https://api.github.com/users/{username}` (REST, API version `2022-11-28`) for name, avatar and counts. Avatars are accepted only from `avatars.githubusercontent.com` and reach the browser through the [media proxy](#media-proxy).
  2. `GET https://github.com/users/{username}/contributions`, the public contribution calendar. This is **HTML, not a versioned API**, so a markup change on GitHub can break parsing. The parser validates strictly (365–371 consecutive days, valid dates and levels); anything unrecognized fails the sync and keeps the previous snapshot.
- **Rate limit:** anonymous REST access allows 60 requests per hour per IP, so PostgreSQL coordinates one GitHub sync every 65 seconds across all server instances, and a rate-limit response postpones the whole provider until its cooldown ends. Other traffic from the same outbound IP reduces the budget.
- **Configuration:** none — no token, OAuth app or cookies.

### How connection syncing works (MyAnimeList and GitHub)

Both providers share one background worker ([`server/src/modules/connections/syncWorker.ts`](../server/src/modules/connections/syncWorker.ts)); viewing a profile only reads stored snapshots and never contacts the providers.

- The worker starts with the API process and checks for due connections every minute. It claims rows with a lease, so several instances never sync the same connection, and discards results if the connection was edited or deleted while the request was in flight.
- Each connection is refreshed every 24 hours. MyAnimeList requests are spaced at least 1.1 seconds apart through a shared PostgreSQL limiter.
- A failed sync keeps the last complete snapshot. `not_found`, `private` and `invalid_response` wait for the next daily cycle; `rate_limited` and `unavailable` retry with exponential backoff (honoring `Retry-After` and `X-RateLimit-Reset`).
- HTTP helper ([`server/src/integrations/connectionHttp.ts`](../server/src/integrations/connectionHttp.ts)): 10-second timeout, redirects are an error, response bodies are capped at 2 MB, and status codes map to the errors above (404 → `not_found`, 403 → `private` or `rate_limited`, 429 → `rate_limited`).
- Connections are managed under Settings → Connections; the owner chooses which widgets appear on the Wall. The games widgets are the exception: they need no connection (see [IGDB](#igdb)). See "Profile connections and Wall" in [DEVELOPMENT.md](DEVELOPMENT.md#profile-connections-and-wall).

## IGDB

Game search behind the four games widgets of the Wall (favorite game, games I like, games in rotation, want to play). Unlike MyAnimeList and GitHub there is **no connected account and no background sync**: the owner picks games by hand, and the server calls IGDB only while someone is searching.

- **Code:** [`server/src/integrations/igdb/igdb.ts`](../server/src/integrations/igdb/igdb.ts) (client and token), [`server/src/modules/games/`](../server/src/modules/games) (search, limits, saved lists). The picker is `web/src/features/games/`.
- **Auth:** IGDB signs in as a Twitch app. `POST https://id.twitch.tv/oauth2/token` with `grant_type=client_credentials` returns a token, which the server keeps in memory until a minute before it expires and replaces once when a request comes back 401. Simultaneous searches share one token request.
- **Search:** `GET /api/games/search?q=` (signed-in users only) runs `POST https://api.igdb.com/v4/games` with `search "…"; fields name,slug,first_release_date,cover.image_id; where version_parent = null; limit 10;` (editions are left out). The query is escaped for Apicalypse. The browser never talks to IGDB and never sees the credentials.
- **Rate limit:** IGDB allows about 4 requests per second per Client ID and answers 429 beyond that. Protections, in order:
  1. The text is normalized (lowercase, collapsed spaces, 2 to 64 characters); a shorter or longer one is a 400 without any request.
  2. Results are cached per normalized query for 6 hours (500 entries, shared by everyone).
  3. Identical searches in flight share one request.
  4. Each user may start 20 searches per minute that miss the cache; cache hits and shared searches are free (`429 rate_limited` with `Retry-After`).
  5. A PostgreSQL-coordinated slot (the `igdb` row of `connection_sync_limits`, one request per 300 ms, so about 3.3 per second across all instances) paces the actual requests. A search waits up to 2 seconds for a slot, then answers 429 with `Retry-After`. When IGDB itself answers 429, the same row holds everybody back for its `Retry-After` (at least a second).
  The client adds a 400 ms debounce, a 2-character minimum, cancellation of the previous request, and an in-memory cache per normalized query.
- **Errors on the wire:** `503 games_unavailable` (no credentials), `502 games_search_failed` (IGDB failed, timed out or sent an unrecognizable payload), `429 rate_limited`, `400 invalid_request`. Failures are never cached.
- **What is stored:** when a game is picked, the client sends back its snapshot (`igdbId`, name, slug, cover `image_id`, release year) and the server saves it in `profile_games`; viewing a profile never calls IGDB. The snapshot comes from the browser, so it is validated strictly (sizes, character sets, no duplicates, list limits) and the server builds the links itself: game pages on `www.igdb.com`, and covers as `/api/media-proxy/igdb/<size>/<image_id>` (`cover_small` in search, `cover_big` on the Wall), which the [media proxy](#media-proxy) fetches from `images.igdb.com`. A person can only misname their own picks. Snapshots are not refreshed afterwards.
- **Limits:** one favorite; eight games in each of the other lists.
- **Configuration:** register an app at <https://dev.twitch.tv/console> (the Twitch account needs two-factor authentication; the OAuth redirect URL is not used, `http://localhost` works) and set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`.
- **When missing:** if either is empty, searching answers `games_unavailable` and the picker says so; the widgets stay available and games already saved still show. The server boots normally.
- **Data sent:** only the search text typed (normalized) goes to IGDB, together with the app's credentials; nothing identifies the user. Covers are fetched by the server too, so IGDB never sees a viewer's IP.
- **Terms:** IGDB is free for non-commercial use under the Twitch Developer Service Agreement; commercial use needs a partnership with IGDB. Each game cover on the Wall links to its page on igdb.com and the game picker credits IGDB as the source of the covers and data; the IGDB docs read so far ask for nothing more.

## Link previews

Cards (title, description, image, favicon) for links pasted in chat. Unlike the services above, the destination is **any website a user chooses**, which makes it a server-side request forgery (SSRF) risk and shapes the whole design.

- **Code:** [`server/src/modules/link-preview/linkPreview.ts`](../server/src/modules/link-preview/linkPreview.ts) and [`server/src/net/safeRequest.ts`](../server/src/net/safeRequest.ts); the endpoint is `GET /api/link-preview?url=…` for signed-in users.
- **Safeguards:** every outbound request goes through `safeRequest`, which validates the resolved IP **at connection time** (so DNS rebinding cannot swap in a private address), follows at most 3 redirects and revalidates each hop, times out after 5 seconds, and reads at most 1.5 MB of the page (stopping at `</head>`).
- **Image size probe:** the server reads the first bytes of the preview image (up to 256 KB, 3-second timeout) to learn its dimensions so the client can reserve space.
- **Cost controls:** results are cached for 6 hours (500 entries, shared by everyone), and each user may trigger 20 *new* fetches per minute; cache hits are free.
- **Pictures:** the preview's image and favicon are stored as the site gave them and sent to browsers as signed [media proxy](#media-proxy) addresses, so they load on networks that block the site and over plain http on an https page.
- **Privacy:** the target site sees the server's IP address, not the user's, for the page and for its pictures.
- **Embeddable links:** URL classification (YouTube, Twitch, direct media) is mirrored in `server/src/modules/link-preview/embeds.ts` and `web/src/shared/lib/chatEmbeds.ts`; change one, change both.

## Embedded players

Pasted YouTube and Twitch links render as inline players. These are loaded **by the user's browser** from the providers' own domains; the server only classifies the URL.

- **Code:** [`web/src/features/media/GenericEmbed.tsx`](../web/src/features/media/GenericEmbed.tsx).
- **YouTube:** a click-to-play thumbnail (the preview image, falling back to `i.ytimg.com`'s `hqdefault.jpg` through `/api/media-proxy/youtube/<video id>`) that becomes a plain `www.youtube.com/embed` iframe, starting at the link's `t`/`start` time. YouTube's script API is not used: it would have to run in our page, which the Content-Security-Policy does not allow.
- **Twitch:** channel, VOD and clip embeds from `player.twitch.tv` and `clips.twitch.tv`, passing the current hostname as the required `parent` parameter.
- The players themselves always come from YouTube's and Twitch's own domains, so they do not play where those are blocked; only the thumbnails go through the [media proxy](#media-proxy).
- No credentials are involved.

## Media proxy

Serves the third-party pictures above from our own domain, `GET /api/media-proxy/...` (signed-in users only), so covers, avatars and previews show on networks that block those services, and the services never see who is looking.

- **Code:** [`server/src/modules/media-proxy/`](../server/src/modules/media-proxy): `mediaProxyUrls.ts` (addresses and allowlist), `mediaProxy.ts` (fetch, cache, limits, routes), `mediaProxyKey.ts` (signing key). The client builds only the two id-based addresses, in `web/src/shared/lib/mediaProxy.ts`.
- **Never an open proxy.** A picture is named either by an id on a fixed host, or by a URL the server already holds, signed with HMAC-SHA256:
  - `/api/media-proxy/igdb/<cover_small|cover_big>/<image_id>` → `images.igdb.com`
  - `/api/media-proxy/youtube/<video id>` → `i.ytimg.com/vi/<id>/hqdefault.jpg`
  - `/api/media-proxy/<mal|github|preview>/<signature>?u=<base64url URL>`, built by the server when it sends a Wall or a link preview. `mal` only reaches `https://cdn.myanimelist.net`, `github` only `https://avatars.githubusercontent.com`, and `preview` any public http(s) host (the pictures the link preview found). Anything else is a 404 without a request.
  - Stored data keeps the original URLs; they are rewritten as they are sent, so stored messages and snapshots do not depend on the key or on the proxy being on.
- **Signing key:** made on first boot and kept in the `instance_secrets` table, so an address a tab already holds still opens after a deploy. Nothing to configure.
- **Safeguards:** every request goes through `net/safeRequest.ts` (IP checked at connection time). No redirects on the fixed hosts, at most 3 for previews. 8-second timeout for the whole download. 5 MB cap (a larger `Content-Length` is refused before reading). The upstream must say `image/*` **and** the bytes must be JPEG, PNG, GIF, WebP, AVIF or ICO; the response's type comes from the bytes. An SVG is never passed on, since it is a document that could run script on our origin: it is drawn into a PNG of at most 512 px with sharp (1 MB and 3-second limits), and librsvg, given bytes with no base path, loads nothing the SVG references.
- **Cache:** in memory, by upstream URL, up to 64 MB (least recently used dropped first), each picture for up to 7 days. A failure (a missing favicon, a removed cover) is remembered for 30 minutes. Simultaneous requests for one picture share one fetch. Browsers get `Cache-Control: private, max-age=604800`, an `ETag` of the content (`If-None-Match` answers 304), `X-Content-Type-Options: nosniff` and `Cross-Origin-Resource-Policy: same-origin`.
- **Rate limits:** only fetches that miss the cache count: 120 per minute per account and 1200 per minute for the whole server (`429 rate_limited` with `Retry-After`).
- **Errors on the wire:** `404 not_found` (unknown or tampered address), `401 unauthenticated`, `415 not_an_image`, `413 image_too_large`, `502 image_unavailable` (upstream failed, timed out or the address is private), `429 rate_limited`.
- **Cost:** each picture is downloaded once per cache lifetime (a restart empties the cache) and then served from memory, so bandwidth grows with the number of distinct pictures and of viewers whose browser does not have them yet; memory stays under the 64 MB budget.
- **Configuration:** `MEDIA_PROXY=0` switches the fetching off to save bandwidth: the same addresses then answer `302` to the service itself, so pictures load as before the proxy (and again depend on the viewer's network).
- **Not covered:** GIFs (KLIPY's terms), direct image links pasted in chat, and webhook embed images still load from their own hosts.

## Adding a new integration

1. **Decide who makes the call.** Prefer the server for anything with a secret or a rate limit. Call from the browser only when the provider's terms require it (as with KLIPY) — and then serve the key through an authenticated endpoint, never the bundle.
2. **Put it in the right place.** Server-side adapters live in `server/src/integrations/<name>/`; domain logic that uses them stays in `server/src/modules/<domain>/`. Frontend-only integrations live inside their feature folder.
3. **Make the credential optional.** Read it in `server/src/config/env.ts`, document it in `.env.example`, and degrade quietly when it is empty (hide the feature or report `unavailable`) rather than crashing the server. Variables that only work together, like the VAPID trio, should fail fast when partly set.
4. **Never trust the destination.** If any part of the URL comes from a user, use `net/safeRequest.ts`. Validate hosts for images and endpoints you accept from a response, and cap time and body size.
5. **Respect rate limits.** For background work, reuse the connection-sync queue and its PostgreSQL-coordinated limits instead of calling providers per profile view; map provider status codes to the shared error codes.
6. **Preserve good data.** A failed or malformed response must never replace a previously valid snapshot.
7. **Test with injected requests.** Adapters take their `request` function as a parameter so tests never hit the network; follow the pattern in `server/tests/integrations/`.
8. **Allow it in the Content-Security-Policy** if the browser talks to it: add the host to `server/src/http/securityHeaders.ts` (see "Content-Security-Policy" in [DEVELOPMENT.md](DEVELOPMENT.md#content-security-policy)). The browser never loads a provider's script into our page.
9. **Document it here:** the table above, the data that leaves our system, and what happens when the credential is missing.
