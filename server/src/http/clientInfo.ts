import type { FastifyRequest } from 'fastify';
import { config } from '../config/env.js';

/** The one place that decides who a caller is, shared by HTTP routes and sockets. Behind the
 * production proxy the socket peer is the proxy itself, so the forwarded header is believed only
 * with `trustProxy` on: without it anyone could claim any address.
 *
 * Each trusted proxy appends the address it received the request from, so the entries only the
 * last `trustedHops` of them wrote are believable, and the client is the one just before them.
 * Counting from the right means whatever the caller put at the start of the header is ignored, even
 * when a proxy appends to it instead of replacing it. Fewer entries than hops means the proxies
 * were the only ones to write it, so the first entry is the earliest address on record. */
export function resolveClientIp(
  trustProxy: boolean,
  forwardedFor: string | string[] | undefined,
  peer: string | undefined,
  trustedHops = 1,
): string {
  if (trustProxy && typeof forwardedFor === 'string') {
    const entries = forwardedFor.split(',').map((entry) => entry.trim());
    const entry = entries[Math.max(0, entries.length - trustedHops)];
    if (entry) return entry;
  }
  return peer || '?';
}

/** The caller's address. Anything keyed on the client (rate limits, session origin, logs) goes
 * through this, never `request.ip`: Fastify is created without `trustProxy`, so `request.ip` is
 * the proxy's address and would put every caller in the same bucket. */
export function clientIpOf(request: FastifyRequest): string {
  return resolveClientIp(config.TRUST_PROXY, request.headers['x-forwarded-for'], request.raw.socket.remoteAddress, config.TRUSTED_PROXY_HOPS);
}

/** What a session is stored with: the address and the browser, clipped to the columns' size. */
export function sessionOriginOf(request: FastifyRequest): { ip: string; userAgent: string } {
  const ua = request.headers['user-agent'];
  return { ip: clientIpOf(request).slice(0, 64), userAgent: (typeof ua === 'string' ? ua : '').slice(0, 512) };
}
