# Third-party integrations

Every external service Linkord talks to, including where its calls originate, which credentials it needs, and what happens when it fails. LiveKit's credentials are in [`.env.example`](../.env.example). Find settings for email, push and other integrations in [`.env.optional.example`](../.env.optional.example).

## Overview

| Service | Purpose | Called from | Credentials | Required |
| --- | --- | --- | --- | --- |
| [LiveKit](#livekit) | Voice, video and screen sharing | Server (SDK) and browser | `LIVEKIT_*` | For calls |
| [Resend](#resend) | Codes for recovery, email changes, two-step login and security changes; sign-in alerts and account notices; data export links | Server | `RESEND_*` | For email flows and two-step login |
| [Web Push](#web-push) | Browser push notifications | Server | `PUSH_VAPID_*` | No |
| [KLIPY](#klipy) | GIF picker | Browser | `KLIPY_API_KEY` | No |
| [MyAnimeList](#myanimelist) | Wall widget | Profile sync worker | `MAL_CLIENT_ID` | No |
| [GitHub](#github) | Wall widgets | Profile sync worker | None | No |
| [GitHub Releases](#github-releases) | The desktop installer the web app offers | Server (on demand, cached) | `DESKTOP_RELEASES_REPO` | No |
| [IGDB](#igdb) | Game search for the Wall; names of games someone is playing | Server (on demand) | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | No |
| [Steam](#steam) | Public profile, recent games and playtime on the Wall | API on connect, profile sync worker for refreshes | `STEAM_WEB_API_KEY` | No |
| [Twitch](#twitch) | Live streams and recent VODs on the Wall | API for setup and live status, profile sync worker for refreshes, browser for the player | `IGDB_CLIENT_ID`, `IGDB_CLIENT_SECRET` | No |
| [SteamGridDB](#steamgriddb) (and Steam's CDN) | Activity icons and fallback banners for Steam games on the Wall | Server (on demand; icons stored and banners cached by us) | `STEAMGRIDDB_API_KEY` | No |
| [Discord application API](#discord-application-api) | Name and pictures of a game reporting through Discord Rich Presence | Server (on demand, cached) | None | No |
| [Link previews](#link-previews) | Cards for links pasted in chat | Server | None | Built in |
| [oEmbed providers](#oembed) | Previews for YouTube, Vimeo, SoundCloud, Spotify, X, TikTok, Reddit | Server | None | Built in |
| [Embedded players](#embedded-players) | YouTube, Twitch, Vimeo, SoundCloud, Streamable players | Browser, after a click | None | Built in |

Third-party pictures (covers, avatars, preview images, favicons, thumbnails) reach the browser through our own [media proxy](#media-proxy), so they show on networks that block those hosts and the hosts never see who is looking. Fonts are bundled (`@fontsource-variable/figtree`), and [webhooks](WEBHOOK.md) are requests into Linkord, not calls we make.

Every server request to a URL that a user or a response chose goes through `server/src/net/safeRequest.ts`, which checks the resolved IP against private and special-purpose ranges at connection time (so DNS rebinding cannot swap one in), revalidates each redirect, and caps time and size.

## LiveKit

The SFU behind every voice channel and DM call.

- **Code:** `server/src/integrations/livekit/livekit.ts` and the `call-token` handling in `server/src/realtime/socket.ts`; the browser uses `livekit-client`.
- **Tokens:** the server signs a short-lived token (`LIVEKIT_TOKEN_TTL_SECONDS`, default 60) for one room, `${LIVEKIT_ROOM_NAME}-${conversationId}`. In a voice channel it grants only what the member's permissions allow (`SPEAK`: microphone; `STREAM`: camera and screen share), so LiveKit itself refuses the rest; a DM call allows everything. Publishing data is off everywhere, so nothing but media reaches a peer. When permissions change mid-call, the server updates or removes the participant. The API key and secret never leave the server.
- **Rooms follow the server:** a connection that leaves a call is removed from its room, and every 15 s the server removes any identity it does not have in that call, since a token cannot be recalled. Each deployment sharing a LiveKit project therefore needs its own `LIVEKIT_ROOM_NAME`.
- **Joining:** a voice channel's `call-join` returns `livekitUrl` and a token. A DM call rings first (`dm-call-start`), and tokens are minted only after `dm-call-accept`.
- **Media:** the camera simulcasts up to the capture's resolution (ideal 1080p30, at most 3 Mbps); screen share is one layer at the chosen preset (1080p60 at 5 Mbps by default, up to 1440p60 at 6 Mbps). Shared window or screen audio is published only where the browser can leave out the call's own sound (Windows 11, macOS 14.2+); elsewhere those shares go without audio. A tab's audio is always published.
- **Restarts and phones.** LiveKit continues carrying media through a backend restart. A connection in a call is held for `CALL_RECONNECT_GRACE_MS` (3 min, compared with `RECONNECT_GRACE_MS` at 30 s), so an Android phone that froze the page in the background can resume the same call. [How clients resume after a restart](DEVELOPMENT.md#how-clients-resume)
- **Configuration:** `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and optionally `LIVEKIT_SERVER_URL`, `LIVEKIT_ROOM_NAME`, `LIVEKIT_TOKEN_TTL_SECONDS`, `CALL_RECONNECT_GRACE_MS`, `CALL_RESTORE_GRACE_MS`. `LIVEKIT_URL` is what browsers use and what the Content-Security-Policy allows (any `*.livekit.cloud` host for LiveKit Cloud). `LIVEKIT_SERVER_URL` (default `LIVEKIT_URL`) is where the server calls LiveKit's API when it reaches it by another address, such as an internal Docker service (`http://livekit:7880`).
- **When missing:** the server boots and logs `LiveKit is not configured`; calls, camera and screen sharing fail.

## Resend

Transactional email: one `POST https://api.resend.com/emails` per message (`server/src/modules/auth/email.ts`), written in the account's language.

| Email | When |
| --- | --- |
| 6-digit code | Password recovery and email changes (also linking a first address to an older account): 30 minutes. Turning two-step login on: 30 minutes. A login's second step: 10 minutes. With two-step login on, a code to the *current* address also confirms deleting the account, turning two-step login or sign-in alerts off and changing the email. Each code allows 5 tries and confirms only its own purpose. |
| New sign-in alert | A password login (or second step) from a browser the account has not used in the last 30 days, naming the browser and system, the IP address and the time. On by default, switchable in Settings → Security; at most 5 per hour. |
| Email changed | To the old address, with the new one masked. The change also signs out every other session. |
| Account deletion | When it is scheduled (with the date; signing in before then cancels it) and once it is done. |
| Data export ready | The download link (only the signed-in account can open it) and its expiry. |

- **Limits:** code emails are capped at 5 per 15 minutes per account and purpose, and wrong codes count against the attempt counters in Postgres ([brute-force limits](DEVELOPMENT.md#brute-force-limits)), so resending buys no extra guesses. Requesting an email change, turning two-step login on or off and turning alerts off also need the current password, so a stolen session alone cannot redirect recovery.
- **Configuration:** `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`. `RESEND_API_URL` (default `https://api.resend.com`) points at a mail sink in development and the end-to-end stack.
- **When missing:** code requests fail with `email_not_configured` and two-step login cannot be turned on; alerts and notices are skipped, and an older account without an email stays on the "link your email" screen. A rejected send fails the request with `503 email_delivery_failed`; notices only log a failure.
- **Two-step login depends on it:** an account with two-step login on cannot finish a login while email is unavailable (`503 email_unavailable`), so removing the `RESEND_*` variables locks those accounts out.
- **Data sent:** the recipient, the code or notice, the username and `APP_URL`; for a sign-in alert also the browser, system, IP address and time.

## Web Push

Push notifications through each browser vendor's push service, with VAPID (`server/src/modules/notifications/webPush.ts`, `web-push`; client in `web/src/shared/pushNotifications.ts`).

- **Destinations:** subscription endpoints come from the browser, so only HTTPS endpoints on `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com` and `*.notify.windows.com`, without a custom port or credentials, are accepted.
- **Content:** written in the recipient's language. A DM is titled by the sender, a channel message `#channel · Server`; mentions, friend requests, acceptances and server invitations name who and where. Message text is cut to 120 characters, and left out when the account turns off "Show message text". New messages in one conversation replace the previous notification. The sender's avatar is fetched by the service worker from our origin (external avatars are never used).
- **Delivery:** by the notification outbox worker, `aes128gcm`, a TTL of one hour for chat messages and 24 hours for the rest, honouring `Retry-After`. Nothing is pushed to an account in do not disturb, or for a server, channel or DM whose notification level or mute rules it out; the notification stays in the in-app list either way.
- **Open tabs:** friend requests, acceptances and invitations also go to the account's open connections as a `notice` socket message, which the desktop app and browsers without push show as a page notification.
- **Configuration:** `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT`, all three or none (the server refuses to start otherwise), from `bunx --bun web-push generate-vapid-keys`. Production needs an HTTPS `APP_URL`. New keys break every existing subscription.
- **When missing:** push is unavailable and nothing is pushed; open tabs still get `notice`.

## KLIPY

GIF search and trending in the composer (`web/src/features/gifs/klipy.ts`; key served by `server/src/modules/gifs/gifs.ts`).

- **Browser only, on purpose:** KLIPY's terms require requests and media to come from the user's client, so nothing is proxied, GIFs included. `GET /api/gifs/config` hands the key to signed-in users, keeping it out of the bundle.
- **Data sent:** a customer ID of `sha256("klipy:" + userId)` cut to 32 characters, stable per user but not our account ID.
- **Configuration:** `KLIPY_API_KEY`; the Content-Security-Policy then allows `https://api.klipy.com`.
- **When missing:** the GIF button is hidden.

## MyAnimeList

The "Recent anime activity" Wall widget (`server/src/integrations/myanimelist/myanimelist.ts`).

- **API:** the official v2 API, the user's 8 most recently updated list entries, with `X-MAL-CLIENT-ID`. Public lists need only the client ID. Covers only from `cdn.myanimelist.net`.
- **Configuration:** register an app at <https://myanimelist.net/apiconfig> and set `MAL_CLIENT_ID`.
- **When missing:** MyAnimeList connections report `unavailable`; nothing else is affected.
- **Data sent:** the username the owner typed.

## GitHub

The "GitHub profile" and "Contributions" Wall widgets (`server/src/integrations/github/github.ts`), with no token, sent with `User-Agent: Linkord`.

- **Requests per sync:** `GET https://api.github.com/users/{username}` for name, avatar and counts, and `GET https://github.com/users/{username}/contributions`, the public contribution calendar. The calendar is HTML, not an API, so a markup change on GitHub can break it; anything unrecognised fails the sync and keeps the previous snapshot.
- **Rate limit:** anonymous access allows 60 requests per hour per IP, so syncs are spaced 65 seconds apart across instances, and a rate-limit answer pauses the provider. Other traffic from the same IP eats into the budget.

### How connection syncing works

The [profile sync worker](DEPLOY.md#profile-sync-worker) refreshes MyAnimeList, GitHub, Steam and Twitch snapshots in a separate process. Viewing a profile reads the snapshots from PostgreSQL. Twitch's live status is checked by the API on its own cache schedule.

- The worker checks for due connections on startup and waits five seconds between batches. It claims each connection with a lease and refreshes it every 24 hours. MyAnimeList requests are spaced 1.1 seconds apart.
- A failed sync keeps the last good snapshot. `not_found`, `private` and `invalid_response` wait for the next day; `rate_limited` and `unavailable` retry with backoff, honouring `Retry-After` and `X-RateLimit-Reset`.
- Requests time out after 10 seconds, refuse redirects and cap bodies at 2 MB (`server/src/integrations/connectionHttp.ts`).

## GitHub Releases

The desktop installer the web app offers: beside the login form, in a one-time announcement for browsers on Windows, and in Settings → Baixar o app. These are the releases installed apps update from ([DEPLOY.md](DEPLOY.md#updates-and-data)).

- **Request:** `GET /api/desktop/downloads` (no session needed) answers the latest release's version, page and Windows installer link, from `GET https://api.github.com/repos/<DESKTOP_RELEASES_REPO>/releases/latest` without a token. Drafts and prereleases are skipped, and a release without a Windows installer counts as none (`server/src/modules/desktop/`).
- **Rate limit:** 60 unauthenticated requests per hour per server address, so the answer is cached 15 minutes (a failure 1 minute, keeping the last good answer).
- **Configuration:** `DESKTOP_RELEASES_REPO=<owner>/<repo>`, the repository the desktop workflow publishes to.
- **When missing:** the route answers 404 and the web app offers no installer. A GitHub outage does the same until the next good answer.
- **Data sent:** nothing about anyone; the browser downloads straight from GitHub.

## IGDB

Game search for the four games widgets (favorite game, games I like, games in rotation, want to play), and the names of games someone is playing. There is no connected account: the owner picks games by hand, and the server calls IGDB only while someone searches or a game is detected.

- **Code:** `server/src/integrations/igdb/igdb.ts`, `server/src/modules/games/`; the picker is `web/src/features/games/`. IGDB signs in with the [Twitch app token](#twitch).
- **Search:** `GET /api/games/search?q=` (signed-in) queries `POST https://api.igdb.com/v4/games` for 10 games, editions left out. The browser never talks to IGDB.
- **Rate limit:** IGDB allows about 4 requests per second per client ID. Queries are normalised (2 to 64 characters), cached 6 hours (500 entries), shared while in flight, and limited to 20 cache misses per user per minute. Real requests are paced through Postgres at one per 300 ms across instances; a search waits up to 2 seconds for a slot, then answers 429. An IGDB 429 holds everyone back for its `Retry-After`.
- **Errors:** `503 games_unavailable` (no credentials), `502 games_search_failed`, `429 rate_limited`, `400 invalid_request`.
- **What is stored:** the picked game's snapshot (id, name, slug, cover id, release year) in `profile_games`, validated strictly since it comes from the browser and never refreshed. The server builds the links itself (game pages on `www.igdb.com`, covers through the media proxy from `images.igdb.com`). One favorite, eight games in each other list.
- **Activity:** `GET /api/activity/game?steam=<app id>&name=<name>` (signed-in) finds the IGDB name of a detected game, by Steam app id first and then by exact name, and returns its icon from [SteamGridDB](#steamgriddb). The answer is shared by everyone in `activity_games` (30 days when found, a day when not), with the same pacing and a budget of 20 misses per user per minute. Without credentials it answers the detected name (`server/src/modules/activity/`).
- **Configuration:** register an app at <https://dev.twitch.tv/console> (the Twitch account needs two-factor authentication; any OAuth redirect URL, `http://localhost` works) and set `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`.
- **When missing:** search answers `games_unavailable` and the picker says so; saved games still show, and the Twitch connection is hidden.
- **Data sent:** the search text, or a game's Steam app id or name, with the app's credentials; nothing about the user.
- **Terms:** free for non-commercial use under the Twitch Developer Service Agreement; commercial use needs an IGDB partnership. Covers on the Wall link to igdb.com and the picker credits IGDB.

## Steam

The Wall shows the public Steam profile, drawn like Steam's own mini profile, and its recent games. The recent widget shows playtime for the last two weeks. The most-played widget ranks those games by lifetime playtime. The connection accepts a vanity name, a SteamID64 or a profile URL, and stores the canonical profile URL.

- **API** `ISteamUser` (`ResolveVanityURL`, `GetPlayerSummaries`) and `IPlayerService` (`GetOwnedGames`, `GetSteamLevel`, `GetProfileItemsEquipped`) on `api.steampowered.com`. A signed-out request to the profile on `steamcommunity.com` supplies the game count, in-game status and eligible app IDs. The playtime request includes only the recent games for which that page shows playtime. Steam requires sign-in to view the full library page.
- **Sync** Connecting checks the profile and its **Game details** are public. The [worker](#how-connection-syncing-works) checks again every 24 hours. If a refresh fails, the Wall hides the saved Steam widgets until the next successful refresh.
- **Mini profile:** the Points Shop items the profile has equipped (`GetProfileItemsEquipped`): the mini profile background (a still picture and its WebM/MP4 loop), the avatar frame and the animated avatar, all files under `community_assets/images/items/` on `shared.fastly.steamstatic.com`. The background fills the compact widget and stays aligned to the top when cropped. An item Steam describes in an unexpected way is left out, never the profile. Snapshots from before this feature show the plain avatar until their next refresh. Under reduced motion the loop gives way to its still picture and the animated avatar and frame to their first frame. Steam draws levels past 100 as other shapes; we keep the ring with its colours per ten.
- **Pictures:** the media proxy serves game banners, avatars, frames and the background's still, and its video side serves the background loop. If the standard CDN address for a game banner fails, the proxy checks the public Steam Store `/api/appdetails` endpoint for that app's official header. If that image is also unavailable, it tries [SteamGridDB](#steamgriddb). The lookup is cached with the image and applies to existing widgets. If no banner loads, the tile displays the game's title in the same 460:215 space. With `MEDIA_PROXY=0`, banners use the direct Steam CDN address.
- **Configuration:** a [Steam Web API key](https://steamcommunity.com/dev/apikey) in `STEAM_WEB_API_KEY`. It stays on the server.
- **When missing:** the Steam connection option is hidden.

## Twitch

The channel with its game, title and viewer count when live (or its offline banner and the last stream's date), and up to six recent VODs, as Wall widgets. The connection is a login name.

- **API:** `server/src/integrations/twitch/twitch.ts` calls [Helix](https://dev.twitch.tv/docs/api/reference/): `GET /users` to check the login, `GET /videos?type=archive&first=6`, and `GET /streams` for live status. One client-credentials token per process is shared with IGDB and renewed a minute before expiry or after a 401.
- **Sync:** connecting reads the profile and VODs; the [worker](#how-connection-syncing-works) refreshes them. Live status is read when a Wall is viewed, cached 60 seconds per login.
- **Pictures:** avatars, offline banners and thumbnails through the media proxy, from Twitch's CDN hosts. The player loads from Twitch after the viewer clicks it.
- **Configuration:** the IGDB app's `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET`.
- **When missing:** the Twitch connection option is hidden.

## SteamGridDB

Community artwork for activity icons and for Steam games on the Wall whose official banners are unavailable.

- **When:** `GET /api/activity/game` looks the icon up next to the IGDB name; with `kind=using` (an app) it looks up only the icon and answers the name as sent. The page first uploads the icon the desktop app read from the program and sends it as `ref`, a reference for picking among the community's icons.
- **Choosing:** the game is found by Steam app id, else by exact name (the newest release among equal names). An app is found as SteamGridDB files software, `<name> (Program)`, else by its exact name, and is kept under a key of its own (`app:<name>`) so it never takes a same-named game's icon. A Steam game uses Steam's own icon when it is 64 px or larger; otherwise the community icon closest to the reference (Steam's small icon, or the program's own for a game outside Steam) wins, falling back to the one marked official, then the first. Only safe-for-work, non-humor, non-epilepsy icons are requested.
- **Wall banners:** the media proxy asks `/api/v2/grids/steam/<app id>` for still grids at 460 × 215 or 920 × 430, excluding NSFW, humorous and epilepsy-tagged artwork. It tries up to three matching images in API order.
- **Stored:** re-encoded to a 96 px WebP in `UPLOAD_DIR/activity-icons/` and served by us; the choice is kept in `activity_game_icons` (30 days when found, a day when not). Which icon a game or app shows is always the server's when it found one, whatever a client reports; the program's own icon stands only for one it did not. 20 misses per user per minute, past which the answer comes without an icon.
- **Configuration:** a key from <https://www.steamgriddb.com/profile/preferences/api> in `STEAMGRIDDB_API_KEY`, sent as a bearer token and never to the browser.
- **When missing or failing:** an activity uses the program's own icon, or a controller or window glyph. A Wall banner still tries Steam's artwork.
- **Data sent:** a game's Steam app id or name, or an app's name, and the key to SteamGridDB. SteamGridDB artwork downloads go to `cdn2.steamgriddb.com`. Steam receives only the app id for a banner lookup or the artwork address for a download.

## Discord application API

Games that support Discord Rich Presence report what the player is doing to the Discord client over a local pipe; when Discord is not running, the desktop app listens instead ([DEVELOPMENT.md](DEVELOPMENT.md#activity-detection)). A game names only its Discord application id and its pictures by key, so the server asks Discord for the rest (`server/src/integrations/discord/discordApps.ts`, `server/src/modules/activity/activityDiscord.ts`).

- **Route:** `POST /api/activity/discord` (signed-in) with `{ appId, images? }` (at most 2 images) answers the application's name and the icon and images as stored activity icons. 30 requests per user per minute.
- **Endpoints:** `GET https://discord.com/api/v10/applications/<id>/rpc` (name and icon) and `.../oauth2/applications/<id>/assets` (Rich Presence images), both public. An image can also be an `https:` link the game chose, or Discord's `mp:external/…` form. Every picture is downloaded by the server and stored like the [SteamGridDB](#steamgriddb) icons; browsers never contact Discord or a game's image host.
- **Cache:** in memory, 24 hours for an application, its assets and a "not found"; 5 minutes (or `Retry-After`) for a failure.
- **What others see:** the server checks what a game sent before passing it on with the activity: text without control characters, cut to 128 characters, stored pictures only, at most 2 buttons with `https:` links. The activity history keeps only the name and icon.
- **When failing:** nothing to configure. The activity shows with the desktop app's own name and icon for it.
- **Data sent:** the application id to Discord's API, and only the picture's address to the CDN or the game's host.

## Link previews

Cards (title, description, pictures, favicon) for links pasted in chat. The destination is any website a user chooses, which makes it a server-side request forgery risk and shapes the design.

- **Code:** `server/src/modules/link-preview/`. `GET /api/link-preview?url=…` for signed-in users; a message's previews are also fetched once after it is sent and stored with it (`modules/messages/messageEmbeds.ts`), at most 5 per message.
- **Resolvers:** [oEmbed](#oembed) for a fixed list of providers, then Open Graph and Twitter tags from the page's `<head>` for everything else. A link that is itself a picture, video or audio file becomes that type.
- **Safeguards:** through `safeRequest`: at most 3 redirects, 5 seconds, 1.5 MB of page (stopping at `</head>`).
- **Pictures:** the first picture is downloaded once through the [media proxy](#media-proxy) to read its size and a blurred placeholder; all pictures and the favicon reach browsers as signed proxy addresses. A direct image link is drawn only from the proxied copy.
- **Video and audio:** direct video and audio links are not proxied; they load from their own host only after the reader clicks "Load video from …", which says that host will see their IP address.
- **Cost controls:** results are cached in memory (500 entries) under a canonical URL (tracking parameters removed), 6 hours for a preview with content and 60 seconds for an empty one. 20 new fetches per user per minute; cache hits are free.
- **Privacy:** the target site sees the server's IP address, not the reader's.
- **Keep in sync:** URL classification (YouTube, Twitch, direct media) is in both `server/src/modules/link-preview/embeds.ts` and `web/src/shared/lib/chatEmbeds.ts`, and the stored preview's newer fields are optional, since older messages and tabs lack them.

### oEmbed

For these providers the server asks the oEmbed endpoint instead of reading the page, whose content is rendered in the browser or very large:

| Provider | Links | Endpoint | Extra parameters |
| --- | --- | --- | --- |
| YouTube | video links in any form, canonicalised to `youtube.com/watch?v=…&t=…` | `https://www.youtube.com/oembed` | `format=json` |
| Vimeo | any `vimeo.com` link | `https://vimeo.com/api/oembed.json` | |
| SoundCloud | any `soundcloud.com` link | `https://soundcloud.com/oembed` | `format=json` |
| Spotify | any `spotify.com` link | `https://open.spotify.com/oembed` | |
| X | `x.com`/`twitter.com` `…/status/<id>` | `https://publish.x.com/oembed` | `dnt=true`, `omit_script=true` |
| TikTok | `…/video/<id>` | `https://www.tiktok.com/oembed` | |
| Reddit | `…/comments/…` | `https://www.reddit.com/oembed` | |

- **Sent:** the link and the parameters above, from the server's IP; answers capped at 64 KB and 6 seconds.
- **Kept:** structured fields only (title, description as plain text, author, provider, thumbnail). The provider's `html` is never stored or rendered; an `<iframe>` in it is kept as the preview's `player` only when its host is on the player allowlist.
- **Failure:** the link falls through to Open Graph.

## Embedded players

YouTube and Twitch links, and previews with a `player` on the allowlist (Vimeo, SoundCloud, Streamable, X), play inline. The browser loads them from the providers' own domains, only after a click, and only one plays at a time (`web/src/features/media/`).

- **YouTube:** a thumbnail (through the media proxy) that becomes a plain `www.youtube.com/embed` iframe. YouTube's script API is not used, since the Content-Security-Policy keeps third-party scripts out of our page.
- **Twitch:** `player.twitch.tv` and `clips.twitch.tv`, with the page's hostname as `parent`.
- **Allowlist:** `PLAYER_HOSTS` in `server/src/modules/link-preview/playerHosts.ts`, mirrored in `web/src/features/media/linkPlayer.ts` (pinned by a test) and the only hosts the policy's `frame-src` allows.
- Where the providers are blocked the players do not load; no credentials are involved.

## Media proxy

Serves the third-party pictures above, and the loop behind a Steam mini profile, from our own domain, `GET /api/media-proxy/...` (signed-in users only), so they show on networks that block those services and the services never see who is looking (`server/src/modules/media-proxy/`).

- **Never an open proxy.** A picture is either an id on a fixed host (`igdb/<size>/<image_id>` → `images.igdb.com`, `youtube/<video id>` → `i.ytimg.com`) or a URL the server already holds, signed with HMAC-SHA256 (`<mal|github|steam|twitch|preview|steam-video>/<signature>?u=…`). Each kind reaches only its own hosts; `preview` reaches any public host a link preview found. Anything else is a 404 without a request. Stored data keeps the original URLs, rewritten as they are sent.
- **Signing key:** made on first boot and kept in `instance_secrets`, so addresses survive a deploy. Nothing to configure.
- **Safeguards:** `safeRequest`, no redirects on fixed hosts (3 for previews), 8 seconds, 5 MB. The upstream must say `image/*` and the bytes must be JPEG, PNG, GIF, WebP, AVIF or ICO. An SVG is never passed on: it is drawn into a PNG of at most 512 px.
- **Variants:** `width` and `height` (16, 32, 64, 128, 256, 400, 640, 800, 1280 or 1920, mirrored in `web/src/shared/lib/mediaProxy.ts`), `format=webp`, `quality=high|low` and `animated=false` (first frame only). Made from the cached original, refused past 40 megapixels (`413 image_too_large`).
- **Videos:** only the `steam-video` kind, from `shared.fastly.steamstatic.com`: up to 16 MB in 20 seconds, the upstream must say `video/*` and the bytes must be WebM or MP4. Read whole into a cache of its own (64 MB) and served by byte range (`Accept-Ranges`, `206`, `416 range_not_satisfiable`), as video players ask. No variants.
- **Cache:** in memory, up to 64 MB for originals and variants, each up to 7 days; a failure is remembered 30 minutes. Browsers get `Cache-Control: private, max-age=604800`, an `ETag`, `nosniff` and `Cross-Origin-Resource-Policy: same-origin`.
- **Rate limits:** cache misses and new variants only: 120 per minute per account, 1200 per minute for the server.
- **Errors:** `404 not_found`, `400 invalid_variant`, `401 unauthenticated`, `415 not_an_image`, `413 image_too_large`, `502 image_unavailable`, `429 rate_limited`; for videos `415 not_a_video`, `413 video_too_large`, `502 video_unavailable` and `416 range_not_satisfiable`.
- **Configuration:** `MEDIA_PROXY=0` stops fetching: the same addresses redirect to the original host, which then sees the viewer's IP, and the policy's `img-src` allows any `https:` host again.
- **Not covered:** KLIPY GIFs (its terms), and direct video and audio links in chat, which load from their own host after a click.

## Adding a new integration

1. **Decide who makes the call.** Prefer the server for anything with a secret or a rate limit. Call from the browser only when the provider's terms require it (as with KLIPY), and then serve the key through an authenticated endpoint, never the bundle.
2. **Put it in the right place.** Adapters in `server/src/integrations/<name>/`, domain logic in `server/src/modules/<domain>/`, frontend-only integrations in their feature folder.
3. **Make the credential optional.** Read it in `server/src/config/env.ts`, document it in `.env.optional.example`, and degrade quietly when it is empty. Variables that only work together, like the VAPID trio, fail fast when partly set.
4. **Never trust the destination.** If any part of the URL comes from a user or a response, use `net/safeRequest.ts`, allowlist image hosts, and cap time and size.
5. **Respect rate limits.** Background work reuses the connection-sync worker and its Postgres-coordinated limits, never a call per profile view.
6. **Preserve good data.** A failed or malformed response never replaces a valid snapshot.
7. **Test with injected requests.** Adapters take their `request` function as a parameter (see `server/tests/integrations/`).
8. **Allow it in the Content-Security-Policy** if the browser talks to it ([DEVELOPMENT.md](DEVELOPMENT.md#content-security-policy)).
9. **Document it here:** the table above, the data that leaves our system, and what happens when the credential is missing.
