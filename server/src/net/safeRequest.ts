import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import type { LookupOptions, LookupAddress } from 'node:dns';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import { isBlockedIp } from './ssrfGuard.js';

// An outbound GET to a URL the server didn't choose itself (a link someone
// pasted in chat, an image a page names). Every such fetch has the same SSRF
// exposure, so they share this: the IP is validated at CONNECTION time (see
// safeLookup), not just by an upfront DNS lookup that DNS rebinding would
// bypass, and redirects are followed by hand so each hop is revalidated.
// What to do with the body is up to the caller's handler.

export const REQUEST_TIMEOUT_MS = 5000;

type Lookup = NonNullable<http.RequestOptions['lookup']>;

/** Custom `lookup` passed to http/https.request — called by Node on EVERY
 * connection attempt (including after a redirect), so it validates the
 * actual IP being used, not just an upfront DNS lookup. */
export function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const safe = list.find((a) => !isBlockedIp(a.address, a.family));
    if (!safe) return callback(new Error('destino bloqueado (IP privado/reservado)'), '');
    if (options.all) return callback(null, [safe]);
    callback(null, safe.address, safe.family);
  });
}

export type ResponseHandler<T> = (
  res: IncomingMessage,
  finalUrl: string,
  resolve: (value: T) => void,
  reject: (error: Error) => void,
) => void;

/** `handle` only sees a 2xx response, after redirects. `lookup` is a seam for
 * tests, which can only reach loopback; production always uses safeLookup. */
export function requestSafe<T>(
  targetUrl: string,
  redirectsLeft: number,
  accept: string,
  handle: ResponseHandler<T>,
  lookup: Lookup = safeLookup as Lookup,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(targetUrl); } catch { return reject(new Error('URL inválida')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('protocolo não suportado'));
    }

    // Node skips `lookup` when the host already is an IP, so a literal one
    // (http://127.0.0.1/, http://[::1]/, a redirect to http://10.0.0.5/) would
    // walk straight past safeLookup. Check it here, before any connection.
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const family = net.isIP(host);
    if (family !== 0 && isBlockedIp(host, family)) return reject(new Error('destino bloqueado (IP privado/reservado)'));

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: 'GET',
      lookup,
      // no pooled sockets: every request goes through `lookup`
      agent: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkordBot/1.0; +link preview)', Accept: accept },
      timeout: timeoutMs,
    }, (res: IncomingMessage) => {
      const status = res.statusCode || 0;

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error('redirecionamentos demais'));
        let nextUrl: string;
        try { nextUrl = new URL(res.headers.location, parsed).toString(); } catch { return reject(new Error('redirecionamento inválido')); }
        return resolve(requestSafe(nextUrl, redirectsLeft - 1, accept, handle, lookup, timeoutMs));
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(Object.assign(new Error(`status ${status}`), { httpStatus: status }));
      }

      handle(res, parsed.toString(), resolve, reject);
    });

    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end();
  });
}
