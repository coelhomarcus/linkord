import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const HOST_BIND = process.env.HOST_BIND || '0.0.0.0';
const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS || 50);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// How many proxies in front of the server append to X-Forwarded-For. A wrong count either believes
// an address the client wrote (too low) or drops to the first proxy's address (too high), so an
// invalid value stops the boot instead of falling back.
export function parseTrustedProxyHops(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  if (text === '') return 1;
  const hops = Number(text);
  if (!Number.isSafeInteger(hops) || hops < 1) throw new Error('TRUSTED_PROXY_HOPS must be a whole number of proxies, 1 or more (see .env.example).');
  return hops;
}
const TRUSTED_PROXY_HOPS = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS);
// Socket.IO TRANSPORT cap (kills the connection if exceeded), not app
// validation — video/uploads don't go through the socket, so 64KB is
// plenty for signaling.
const MAX_MSG_BYTES = Number(process.env.MAX_MSG_BYTES || 64 * 1024);
// how long a dropped connection's identity is held for reconnection before
// counting as "left".
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 30000);
// the same, for a connection that was in a call. Longer because Android freezes
// a backgrounded page: a person who switches apps mid-call stops answering the
// heartbeat, and should find the call still there when they come back.
const CALL_RECONNECT_GRACE_MS = Number(process.env.CALL_RECONNECT_GRACE_MS || 180000);
// how long, after a restart, the people who were in a call are held for their
// clients to reconnect. Longer than the usual grace: a deploy plus the clients'
// reconnect backoff routinely takes more than 30 seconds.
const CALL_RESTORE_GRACE_MS = Number(process.env.CALL_RESTORE_GRACE_MS || 90000);
const MAX_AVATAR_LEN = 500;
const MAX_BANNER_LEN = 500;
const MAX_PROFILE_BIO_LEN = 300;
const MAX_PROFILE_LINKS = 8;
const MAX_PROFILE_LINK_LEN = 300;
const MAX_CHAT_LEN = 2000;
const CHAT_HISTORY_LIMIT = 50; // messages kept to give context to whoever joins later
const SEARCH_RESULT_LIMIT = 30; // server-fixed, not client-controlled — same posture as CHAT_HISTORY_LIMIT
const MAX_SEARCH_QUERY_LEN = 200;
const MAX_ATTACHMENTS_PER_MESSAGE = 4;
// Cooldown after a declined, cancelled, or removed request; the other party may still request
// immediately. This initial limit needs adjustment based on real usage.
const FRIEND_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// gates NEW joins only: a server already above this keeps every member.
// The MAX_GROUP_* names are read too, so a deploy configured before servers
// keeps its numbers.
const MAX_SERVER_MEMBERS = Number(process.env.MAX_SERVER_MEMBERS || process.env.MAX_GROUP_MEMBERS || 100);
const MAX_CHANNELS_PER_SERVER = Number(process.env.MAX_CHANNELS_PER_SERVER || 50);
const MAX_ROLES_PER_SERVER = Number(process.env.MAX_ROLES_PER_SERVER || 25);
const MAX_INVITES_PER_SERVER = Number(process.env.MAX_INVITES_PER_SERVER || 50);
const MAX_WEBHOOKS_PER_CHANNEL = Number(process.env.MAX_WEBHOOKS_PER_CHANNEL || 10);
const MAX_INVITEES_PER_REQUEST = 20;

// anchored to the repo root (not cwd) — inside Docker this is /app/uploads
// (matches the external bind mount); in `npm run dev` it's <repo>/uploads.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(import.meta.dirname, '..', '..', '..', 'uploads');
// the largest single file anyone may upload; uploads are chunked, so this is bounded by disk, not by proxies
const MAX_ATTACHMENT_BYTES = Number(process.env.MAX_ATTACHMENT_BYTES || 512 * 1024 * 1024);
if (!Number.isSafeInteger(MAX_ATTACHMENT_BYTES) || MAX_ATTACHMENT_BYTES <= 0) {
  throw new Error('MAX_ATTACHMENT_BYTES must be a positive whole number of bytes (see .env.example).');
}
const MAX_STORAGE_BYTES = 30 * 1024 * 1024 * 1024;
// comfortably under common proxy limits (e.g. Cloudflare Free/Pro caps
// request bodies around 100MB)
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
// abandoned upload session (UPLOAD_DIR/tmp/<uploadId>) expiry — swept at
// boot and hourly.
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// avatar — same folder/route as attachments, smaller cap, one per account,
// excluded from the attachment quota.
const MAX_AVATAR_BYTES = 12 * 1024 * 1024;

// required now that identity lives in the DB — the process won't boot
// without it (see bootstrap in index.ts).
const DATABASE_URL = process.env.DATABASE_URL || '';
// DB URL is remote; without sslmode, credentials/session data cross the
// network in plaintext. '1' enables TLS.
const DATABASE_SSL = process.env.DATABASE_SSL === '1';
// Optional pinned CA (PEM) for a Postgres that presents a self-signed or
// privately-issued cert Node's default trust store won't validate — the
// certificate verification stays ON (see db/client.ts), it's just checked
// against this cert instead of the public CA bundle. Supports either a
// literal multi-line value or a single-line one with escaped "\n"s (the
// common way to fit a PEM into a one-line .env/Dokploy variable).
const DATABASE_SSL_CA = (process.env.DATABASE_SSL_CA || '').replace(/\\n/g, '\n').trim();
// runs pending migrations before accepting connections — on by default
// since neither deploy path (Docker CMD, systemd ExecStart) goes through
// an npm script.
const MIGRATE_ON_BOOT = process.env.MIGRATE_ON_BOOT !== '0';

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'ss_session';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
// A session nobody used for this many days ends even if its TTL has not run out (0 turns it off).
// "Used" is any request, a socket handshake or a socket that stayed connected (see session.ts).
const SESSION_IDLE_DAYS = Number(process.env.SESSION_IDLE_DAYS ?? 14);
if (!Number.isFinite(SESSION_IDLE_DAYS) || SESSION_IDLE_DAYS < 0) throw new Error('SESSION_IDLE_DAYS must be 0 or a positive number of days.');
// closed by default: fail-closed so a deploy that forgot to set this
// doesn't become open registration.
const REGISTRATION_CODE = process.env.REGISTRATION_CODE || '';
// (ADMIN_USERNAME is gone: registering never grants admin anymore. Admins are
// provisioned explicitly — `npm run admin:grant -- <username>` or the /admin area.)
// 'auto' reads X-Forwarded-Proto (set by Caddy/nginx); '1'/'0' force it —
// otherwise the Secure cookie attribute breaks local http:// dev.
const COOKIE_SECURE = process.env.COOKIE_SECURE || 'auto';
// HTTP request body (login/register JSON) — unrelated to MAX_MSG_BYTES
// (Socket.IO's own transport cap).
const MAX_BODY_BYTES = 8 * 1024;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 20;
const MAX_DISPLAY_NAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200; // hygiene cap — hashing a 1MB password would be a DoS vector
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || '';
// Only the end-to-end stack changes this, to a local mail sink that records what would be sent.
const RESEND_API_URL = (process.env.RESEND_API_URL || 'https://api.resend.com').trim().replace(/\/+$/, '');
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const PUSH_VAPID_PUBLIC_KEY = (process.env.PUSH_VAPID_PUBLIC_KEY || '').trim();
const PUSH_VAPID_PRIVATE_KEY = (process.env.PUSH_VAPID_PRIVATE_KEY || '').trim();
const PUSH_VAPID_SUBJECT = (process.env.PUSH_VAPID_SUBJECT || '').trim();
if ([PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT].some(Boolean)
  && ![PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT].every(Boolean)) {
  throw new Error('Configure all three PUSH_VAPID_* variables together.');
}
if (PUSH_VAPID_PUBLIC_KEY) {
  let appOrigin: URL;
  try { appOrigin = new URL(APP_URL); } catch { throw new Error('APP_URL must be a valid origin when Web Push is enabled.'); }
  const localDev = process.env.NODE_ENV !== 'production' && appOrigin.protocol === 'http:'
    && (appOrigin.hostname === 'localhost' || appOrigin.hostname === '127.0.0.1');
  if (appOrigin.protocol !== 'https:' && !localDev) throw new Error('APP_URL must be HTTPS when Web Push is enabled.');
}
const AUTH_CODE_TTL_MS = 30 * 60 * 1000;
const AUTH_CODE_MAX_ATTEMPTS = 5;
// The code that finishes a two-step login: short, since the person is waiting on the login screen.
const LOGIN_CODE_TTL_MS = 10 * 60 * 1000;

// LiveKit Cloud — camera/screen become real WebRTC (managed SFU).
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
// prefix for each call's LiveKit room name (see
// integrations/livekit/livekit.ts) — one room per voice channel or DM, not a single shared one.
const LIVEKIT_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'linkord-room';
// A token only gates ENTERING a room; LiveKit can't recall one already issued,
// so a short life bounds how long a removed member could still reconnect with
// an old token (removal also evicts live connections, see evictFromCall).
const LIVEKIT_TOKEN_TTL_SECONDS = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 300);

// KLIPY (GIFs). Their terms want API calls made from the user's browser, so
// this key is handed to signed-in clients (modules/gifs) rather than used here;
// empty turns the GIF picker off.
const KLIPY_API_KEY = (process.env.KLIPY_API_KEY || '').trim();

// Application client ID for the official MyAnimeList API, which reads public lists
// without user login. Empty leaves MyAnimeList connections unavailable.
const MAL_CLIENT_ID = (process.env.MAL_CLIENT_ID || '').trim();

// IGDB (game search for the Wall's games widgets) signs in as a Twitch app. Either one empty leaves
// the games widgets without search: they still show what was already picked.
const IGDB_CLIENT_ID = (process.env.IGDB_CLIENT_ID || '').trim();
const IGDB_CLIENT_SECRET = (process.env.IGDB_CLIENT_SECRET || '').trim();

// Third-party pictures (game and anime covers, GitHub avatars, link preview
// images and favicons, YouTube thumbnails) are served from our own domain by
// modules/media-proxy, so they show on networks that block those services
// and never hand a viewer's IP to them. '0' saves the bandwidth: the same
// links then redirect the browser to the service instead.
const MEDIA_PROXY_ENABLED = process.env.MEDIA_PROXY !== '0';

// optional, dev convenience only: when DATABASE_URL points at the same DB a
// deployed instance uses, `attachments` rows exist locally but the actual
// FILES only live on that instance's disk (UPLOAD_DIR is always local, never
// synced). Set this to that instance's base URL and serveUpload will fetch
// (and cache) a missing file from there on first request instead of 404ing.
// Never needed in the deployment this var would point AT. Trailing slash
// stripped so `${UPLOADS_REMOTE_URL}/uploads/<id>` doesn't double up.
const UPLOADS_REMOTE_URL = (process.env.UPLOADS_REMOTE_URL || '').trim().replace(/\/+$/, '');

// ---- abuse limits (initial estimates; tune based on actual usage) ----
const REGISTRATIONS_PER_IP_PER_HOUR = Number(process.env.REGISTRATIONS_PER_IP_PER_HOUR || 5);
const MAX_NEW_ACCOUNTS_PER_HOUR = Number(process.env.MAX_NEW_ACCOUNTS_PER_HOUR || 30);
const MAX_CONNECTIONS_PER_USER = Number(process.env.MAX_CONNECTIONS_PER_USER || 5);
// per-account quotas (storage has none: only the instance-wide MAX_STORAGE_BYTES)
const MAX_OWNED_SERVERS_PER_USER = Number(process.env.MAX_OWNED_SERVERS_PER_USER || process.env.MAX_OWNED_GROUPS_PER_USER || 20);
const MAX_SERVER_MEMBERSHIPS_PER_USER = Number(process.env.MAX_SERVER_MEMBERSHIPS_PER_USER || process.env.MAX_GROUP_MEMBERSHIPS_PER_USER || 100);
const MAX_FRIENDS = Number(process.env.MAX_FRIENDS || 500);
const MAX_PENDING_OUTGOING_REQUESTS = Number(process.env.MAX_PENDING_OUTGOING_REQUESTS || 50);
// extra browser origins allowed to call the API/socket (comma-separated), on
// top of APP_URL and the request's own host — see http/originGuard.ts.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
// '1' sends the Content-Security-Policy as Report-Only: violations are reported
// (POST /api/csp-reports, logged) but nothing is blocked. For trying out a
// change to the policy; see http/securityHeaders.ts.
const CSP_REPORT_ONLY = process.env.CSP_REPORT_ONLY === '1';
// production-like unless NODE_ENV says otherwise; only used to allow the Vite dev origin.
const IS_DEV = process.env.NODE_ENV === 'development' || (!process.env.NODE_ENV && !process.env.APP_URL);
// files on disk with no `attachments` row are only collected after this long,
// so an upload that is still being committed is never mistaken for an orphan.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
// the scheduled orphan sweep only REPORTS unless this is '0' (an admin can still
// run a real one by hand from /admin). Deleting files is opt-in on purpose.
const ORPHAN_SWEEP_DRY_RUN = process.env.ORPHAN_SWEEP_DRY_RUN !== '0';

// ---- retention (days a kind of record is kept; 0 = keep forever) ----
// An invalid value stops the boot instead of falling back: a typo must not quietly start
// deleting an audit trail, or quietly keep one that was meant to expire.
export function parseRetentionDays(name: string, raw: string | undefined, fallback: number): number {
  const text = (raw ?? '').trim();
  if (text === '') return fallback;
  const days = Number(text);
  if (!Number.isSafeInteger(days) || days < 0) throw new Error(`${name} must be a whole number of days, 0 or more (0 keeps the records forever; see .env.example).`);
  return days;
}
// the audit trail and data_repairs are evidence: they are kept unless an operator opts in to expiry
const AUDIT_RETENTION_DAYS = parseRetentionDays('AUDIT_RETENTION_DAYS', process.env.AUDIT_RETENTION_DAYS, 0);
const DATA_REPAIRS_RETENTION_DAYS = parseRetentionDays('DATA_REPAIRS_RETENTION_DAYS', process.env.DATA_REPAIRS_RETENTION_DAYS, 0);
const NOTIFICATION_READ_RETENTION_DAYS = parseRetentionDays('NOTIFICATION_READ_RETENTION_DAYS', process.env.NOTIFICATION_READ_RETENTION_DAYS, 30);
const NOTIFICATION_UNREAD_RETENTION_DAYS = parseRetentionDays('NOTIFICATION_UNREAD_RETENTION_DAYS', process.env.NOTIFICATION_UNREAD_RETENTION_DAYS, 90);
const OUTBOX_RETENTION_DAYS = parseRetentionDays('OUTBOX_RETENTION_DAYS', process.env.OUTBOX_RETENTION_DAYS, 7);
// a server's own log is a moderation aid, not instance evidence: it expires by default
const SERVER_AUDIT_RETENTION_DAYS = parseRetentionDays('SERVER_AUDIT_RETENTION_DAYS', process.env.SERVER_AUDIT_RETENTION_DAYS, 90);

export const config = {
  AUDIT_RETENTION_DAYS, DATA_REPAIRS_RETENTION_DAYS, NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS, OUTBOX_RETENTION_DAYS, SERVER_AUDIT_RETENTION_DAYS,
  PORT, HOST_BIND, MAX_PARTICIPANTS, TRUST_PROXY, TRUSTED_PROXY_HOPS, MAX_MSG_BYTES, RECONNECT_GRACE_MS, CALL_RECONNECT_GRACE_MS, CALL_RESTORE_GRACE_MS,
  MAX_AVATAR_LEN, MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINKS, MAX_PROFILE_LINK_LEN,
  MAX_CHAT_LEN, CHAT_HISTORY_LIMIT, SEARCH_RESULT_LIMIT, MAX_SEARCH_QUERY_LEN, MAX_ATTACHMENTS_PER_MESSAGE,
  FRIEND_REQUEST_COOLDOWN_MS, MAX_SERVER_MEMBERS, MAX_CHANNELS_PER_SERVER, MAX_ROLES_PER_SERVER, MAX_INVITES_PER_SERVER, MAX_WEBHOOKS_PER_CHANNEL, MAX_INVITEES_PER_REQUEST,
  UPLOAD_DIR, MAX_ATTACHMENT_BYTES, MAX_STORAGE_BYTES, MAX_AVATAR_BYTES,
  UPLOAD_CHUNK_BYTES, UPLOAD_SESSION_TTL_MS,
  DATABASE_URL, DATABASE_SSL, DATABASE_SSL_CA, MIGRATE_ON_BOOT,
  SESSION_COOKIE, SESSION_TTL_DAYS, SESSION_IDLE_DAYS, REGISTRATION_CODE,
  COOKIE_SECURE, MAX_BODY_BYTES,
  MIN_USERNAME_LEN, MAX_USERNAME_LEN, MAX_DISPLAY_NAME_LEN, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN,
  RESEND_API_KEY, RESEND_FROM_EMAIL, RESEND_API_URL, APP_URL, AUTH_CODE_TTL_MS, AUTH_CODE_MAX_ATTEMPTS, LOGIN_CODE_TTL_MS,
  PUSH_VAPID_PUBLIC_KEY, PUSH_VAPID_PRIVATE_KEY, PUSH_VAPID_SUBJECT,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_ROOM_NAME, LIVEKIT_TOKEN_TTL_SECONDS,
  UPLOADS_REMOTE_URL, KLIPY_API_KEY, MAL_CLIENT_ID, IGDB_CLIENT_ID, IGDB_CLIENT_SECRET, MEDIA_PROXY_ENABLED,
  REGISTRATIONS_PER_IP_PER_HOUR, MAX_NEW_ACCOUNTS_PER_HOUR, MAX_CONNECTIONS_PER_USER,
  MAX_OWNED_SERVERS_PER_USER, MAX_SERVER_MEMBERSHIPS_PER_USER, MAX_FRIENDS, MAX_PENDING_OUTGOING_REQUESTS,
  ALLOWED_ORIGINS, CSP_REPORT_ONLY, IS_DEV, ORPHAN_GRACE_MS, ORPHAN_SWEEP_DRY_RUN,
};
