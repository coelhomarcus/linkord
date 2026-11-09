import type { FastifyRequest } from 'fastify';
import { config } from '../config/env.js';

/** The caller's address. Behind the production proxy the socket peer is the proxy itself, so the
 * forwarded header is believed only with TRUST_PROXY on: without it anyone could claim any address. */
export function clientIpOf(request: FastifyRequest): string {
  if (config.TRUST_PROXY) {
    const fwd = request.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  }
  return request.raw.socket.remoteAddress || '?';
}

/** What a session is stored with: the address and the browser, clipped to the columns' size. */
export function sessionOriginOf(request: FastifyRequest): { ip: string; userAgent: string } {
  const ua = request.headers['user-agent'];
  return { ip: clientIpOf(request).slice(0, 64), userAgent: (typeof ua === 'string' ? ua : '').slice(0, 512) };
}
