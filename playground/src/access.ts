import crypto from 'node:crypto';

// Reads a pass the app signed (server/src/modules/playground/playgroundToken.ts)
// with the PLAYGROUND_SECRET both share. This service has no accounts of its own:
// a valid pass says which connection of which account is in which playground
// call, until it expires.

export interface PlaygroundClaims {
  pid: string;
  uid: string;
  cid: string;
  exp: number;
}

const MAX_TOKEN_LENGTH = 1024;
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;

/** The claims of a pass signed with `secret` and not expired at `now`, or null. */
export function verifyPlaygroundToken(token: unknown, secret: string, now: number): PlaygroundClaims | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return null;
  let claims: unknown;
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!claims || typeof claims !== 'object') return null;
  const { pid, uid, cid, exp } = claims as Record<string, unknown>;
  if (!isId(pid) || !isId(uid) || !isId(cid) || typeof exp !== 'number' || !Number.isFinite(exp) || exp <= now) return null;
  return { pid, uid, cid, exp };
}

const INTERNAL_REQUEST_MAX_AGE_MS = 5 * 60 * 1000;

/** Whether a request to /playground/internal/ came from the app: its `x-playground-signature` is an
 * HMAC of its time and body (server/src/modules/playground/playgroundToken.ts), made recently. */
export function verifyInternalRequest(signature: unknown, body: string, secret: string, now: number): boolean {
  if (typeof signature !== 'string' || signature.length > 200) return false;
  const dot = signature.indexOf('.');
  const at = Number(signature.slice(0, dot));
  if (dot <= 0 || !Number.isSafeInteger(at) || Math.abs(now - at) > INTERNAL_REQUEST_MAX_AGE_MS) return false;
  const mac = Buffer.from(signature.slice(dot + 1), 'base64url');
  const expected = crypto.createHmac('sha256', secret).update(`${at}.${body}`).digest();
  return mac.length === expected.length && crypto.timingSafeEqual(mac, expected);
}
