import { isIPv4, isIPv6 } from 'node:net';
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

/** The caller's address. Anything about the client (session origin, logs) goes through this, never
 * `request.ip`: Fastify is created without `trustProxy`, so `request.ip` is the proxy's address
 * and would put every caller in the same bucket. Rate limits key on `rateLimitSubjectOf` instead. */
export function clientIpOf(request: FastifyRequest): string {
  return resolveClientIp(config.TRUST_PROXY, request.headers['x-forwarded-for'], request.raw.socket.remoteAddress, config.TRUSTED_PROXY_HOPS);
}

/** The bucket a per-address limit counts the caller in. An IPv6 client usually holds a whole /64
 * (any VPS, most residential lines) and can pick a fresh address for every request, so IPv6 is cut
 * to its /64 prefix. IPv4 stays whole, and an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, what a
 * dual-stack socket reports for an IPv4 peer) counts as the IPv4 address it carries. A zone id
 * (`%eth0`) names a local interface, not a client, so it is dropped. Anything that is not an
 * address, such as the `?` placeholder, is its own bucket. */
export function rateLimitSubject(ip: string): string {
  const address = ip.trim().replace(/%.*$/, '');
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return ip;
  const groups = ipv6Groups(address);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

/** The eight 16-bit groups of an address `isIPv6` accepted, with `::` expanded and a dotted IPv4
 * tail turned into its two groups. */
function ipv6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parse = (part: string | undefined) => (part ? part.split(':').map((group) => parseInt(group, 16)) : []);
  const [head, tail] = text.split('::');
  const left = parse(head);
  if (tail === undefined) return left;
  const right = parse(tail);
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/** `rateLimitSubject` of the caller's address. */
export function rateLimitSubjectOf(request: FastifyRequest): string {
  return rateLimitSubject(clientIpOf(request));
}

/** What a session is stored with: the address and the browser, clipped to the columns' size. */
export function sessionOriginOf(request: FastifyRequest): { ip: string; userAgent: string } {
  const ua = request.headers['user-agent'];
  return { ip: clientIpOf(request).slice(0, 64), userAgent: (typeof ua === 'string' ? ua : '').slice(0, 512) };
}
