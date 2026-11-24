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
