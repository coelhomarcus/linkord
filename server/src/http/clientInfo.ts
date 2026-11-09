import type { FastifyRequest } from 'fastify';
import { config } from '../config/env.js';

/** The one place that decides who a caller is, shared by HTTP routes and sockets. Behind the
 * production proxy the socket peer is the proxy itself, so the forwarded header is believed only
 * with `trustProxy` on: without it anyone could claim any address. */
export function resolveClientIp(trustProxy: boolean, forwardedFor: string | string[] | undefined, peer: string | undefined): string {
  if (trustProxy && typeof forwardedFor === 'string') {
    const first = forwardedFor.split(',')[0]!.trim();
    if (first) return first;
  }
  return peer || '?';
}

/** The caller's address. Anything keyed on the client (rate limits, session origin, logs) goes
 * through this, never `request.ip`: Fastify is created without `trustProxy`, so `request.ip` is
 * the proxy's address and would put every caller in the same bucket. */
export function clientIpOf(request: FastifyRequest): string {
  return resolveClientIp(config.TRUST_PROXY, request.headers['x-forwarded-for'], request.raw.socket.remoteAddress);
}

/** What a session is stored with: the address and the browser, clipped to the columns' size. */
export function sessionOriginOf(request: FastifyRequest): { ip: string; userAgent: string } {
  const ua = request.headers['user-agent'];
  return { ip: clientIpOf(request).slice(0, 64), userAgent: (typeof ua === 'string' ? ua : '').slice(0, 512) };
}
