// Shared by every module that fetches a URL the server didn't choose itself
// (link-preview's Open Graph fetch, the avatar/banner "usar URL" download)
// — kept as a leaf module, no dependency on the rest of the app, so both can
// import it without risking a cycle. Used as the `lookup` override passed
// to http/https.request in each caller, so it's checked at CONNECTION
// time (on every hop, including redirects), not just an upfront DNS
// lookup — which DNS rebinding would bypass.

import net from 'node:net';

// IPv6 ranges that are never a public destination. Checked as CIDR on the
// parsed bytes rather than by string prefix: `fe80:` alone misses the rest of
// fe80::/10 (fe90::, febf::), and text forms vary (`::7f00:1`, `0::1`).
const BLOCKED_V6: ReadonlyArray<readonly [prefix: string, bits: number]> = [
  ['::', 96], // unspecified, loopback and deprecated IPv4-compatible (::a.b.c.d)
  ['64:ff9b:1::', 48], // local-use NAT64: where the IPv4 sits depends on the operator's prefix length
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo: the embedded address is obfuscated, and relays are not ours to choose
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
];

// Ranges that carry an IPv4 address the connection really ends up at, so the
// IPv4 rules decide: 64:ff9b::7f00:1 is 127.0.0.1 on a host with NAT64.
const EMBEDDED_V4: ReadonlyArray<readonly [prefix: string, bits: number, offset: number]> = [
  ['::ffff:0:0', 96, 12], // IPv4-mapped
  ['64:ff9b::', 96, 12], // well-known NAT64
  ['2002::', 16, 2], // 6to4
];

/** The 16 bytes of an IPv6 address, or null when it isn't one. A zone id
 * (`fe80::1%eth0`) is dropped. */
function parseIPv6(address: string): Uint8Array | null {
  const ip = address.split('%')[0]!;
  if (!net.isIPv6(ip)) return null;
  let text = ip.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number) as number[];
    text = `${text.slice(0, dotted.index)}${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string?];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right];
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const n = parseInt(g, 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 255;
  });
  return bytes;
}

function inRange(bytes: Uint8Array, prefix: string, bits: number): boolean {
  const base = parseIPv6(prefix)!;
  for (let i = 0; i < 16 && bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if ((bytes[i]! & mask) !== (base[i]! & mask)) return false;
  }
  return true;
}

function isBlockedIPv6(address: string): boolean {
  const bytes = parseIPv6(address);
  if (!bytes) return true;
  for (const [prefix, bits, offset] of EMBEDDED_V4) {
    if (inRange(bytes, prefix, bits)) return isBlockedIp(bytes.slice(offset, offset + 4).join('.'), 4);
  }
  return BLOCKED_V6.some(([prefix, bits]) => inRange(bytes, prefix, bits));
}

/** True = private/reserved address, never safe to connect to from the
 * server (RFC1918, loopback, link-local, CGNAT, IPv4 test/multicast ranges;
 * the special-purpose IPv6 ranges above, with an embedded IPv4 address judged
 * by the IPv4 rules). Anything that doesn't parse is blocked. */
export function isBlockedIp(address: string, family: number): boolean {
  if (family === 6) return isBlockedIPv6(address);
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  // these test/benchmark ranges are all /24s (one specific 3rd octet) — the
  // rest of the /16 is real public space (e.g. 192.0.66.0/24 is NASA's).
  // Checking only a/b without c would block a whole /16 by mistake.
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmark) — this one really is the whole /15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
  if (a >= 224) return true; // multicast + reserved
  return false;
}
