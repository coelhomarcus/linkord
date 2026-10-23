import type { IncomingMessage } from 'node:http';
import { config } from '../config/env.js';

// Hand-rolled cookie parse/serialize — kept manual even after moving to
// Fastify (see http/app.ts) since Socket.IO's own handshake auth uses the
// same parseCookies; a framework cookie plugin would mean a second
// implementation to keep in sync.

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    const value = part.slice(idx + 1).trim();
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

/** The raw session token for a request. The web app sends it as the session
 * cookie; the native app shells (Tauri desktop, React Native) send it as a
 * Bearer token, because a webview loading its UI from a non-http origin
 * (tauri://localhost) is never given a cross-site cookie jar by WebKit — the
 * cookie is silently dropped no matter what SameSite says. Cookie first, so
 * a browser can't be talked into authenticating as someone else by a
 * forged Authorization header. */
export function sessionTokenFromHeaders(headers: { cookie?: string; authorization?: string }): string | undefined {
  const fromCookie = parseCookies(headers.cookie || '')[config.SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const auth = headers.authorization;
  if (!auth) return undefined;
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') return undefined;
  return token?.trim() || undefined;
}

/** Decides the cookie's Secure attribute. 'auto' (default) trusts
 * X-Forwarded-Proto when TRUST_PROXY is on — the deploy's Caddyfile/
 * nginx.conf already send that header. Without it, the Secure cookie just
 * wouldn't save on local http://localhost dev. */
export function isSecureRequest(req: IncomingMessage): boolean {
  if (config.COOKIE_SECURE === '1') return true;
  if (config.COOKIE_SECURE === '0') return false;
  if (req.socket && (req.socket as { encrypted?: boolean }).encrypted) return true;
  if (config.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https') return true;
  return false;
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAgeSec, secure, sameSite = 'Lax' }: { maxAgeSec?: number; secure: boolean; sameSite?: 'Lax' | 'None' },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (typeof maxAgeSec === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, { secure, sameSite = 'Lax' }: { secure: boolean; sameSite?: 'Lax' | 'None' }): string {
  return serializeCookie(name, '', { maxAgeSec: 0, secure, sameSite });
}
