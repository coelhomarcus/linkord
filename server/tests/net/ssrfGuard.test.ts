import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedIp } from '../../src/net/ssrfGuard.js';

describe('isBlockedIp — SSRF protection', () => {
  const blockedV4 = [
    '127.0.0.1', // loopback
    '10.0.0.5', // RFC1918
    '172.16.0.1', '172.31.255.255', // RFC1918 172.16.0.0/12
    '192.168.1.1', // RFC1918
    '169.254.1.1', // link-local
    '100.64.0.1', // CGNAT
    '0.0.0.0',
    '192.0.0.8', // 192.0.0.0/24 (IETF Protocol Assignments)
    '192.0.2.55', // 192.0.2.0/24 (TEST-NET-1)
    '198.51.100.5', // TEST-NET-2
    '203.0.113.5', // TEST-NET-3
    '198.18.5.5', '198.19.5.5', // benchmark 198.18.0.0/15
    '224.0.0.1', // multicast
  ];
  for (const ip of blockedV4) {
    test(`blocks ${ip}`, () => assert.equal(isBlockedIp(ip, 4), true));
  }

  // regression: the real bug that flagged nasa.gov as a false positive — the
  // check for 192.0.0.0/24 and 192.0.2.0/24 (both /24s) had been written
  // without looking at the third octet, blocking the entire /16
  // (192.0.0.0-192.0.255.255) by mistake. The rest of that /16 is genuinely
  // public space — 192.0.66.0/24 belongs to NASA itself.
  const publicV4 = [
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // just outside the private /12
    '192.0.3.1', // inside the /16 but OUTSIDE both reserved /24s
    '192.0.66.47', // real IP used by www.nasa.gov
    '198.51.101.5', // outside the reserved /24 (198.51.100.0/24)
    '203.0.114.5', // outside the reserved /24 (203.0.113.0/24)
    '198.20.5.5', // just outside the benchmark /15
  ];
  for (const ip of publicV4) {
    test(`does NOT block ${ip} (public)`, () => assert.equal(isBlockedIp(ip, 4), false));
  }

  test('a malformed IPv4 address is blocked for safety (fail closed)', () => {
    assert.equal(isBlockedIp('not-an-ip', 4), true);
  });

  describe('IPv6', () => {
    test('blocks loopback/link-local/ULA', () => {
      assert.equal(isBlockedIp('::1', 6), true);
      assert.equal(isBlockedIp('fe80::1', 6), true);
      assert.equal(isBlockedIp('fc00::1', 6), true);
      assert.equal(isBlockedIp('fd12::1', 6), true);
    });

    test('does not block public IPv6', () => {
      assert.equal(isBlockedIp('2606:4700:4700::1111', 6), false);
    });

    test('unwraps an IPv4-mapped IPv6 (::ffff:a.b.c.d) and validates the v4 part', () => {
      assert.equal(isBlockedIp('::ffff:127.0.0.1', 6), true);
      assert.equal(isBlockedIp('::ffff:8.8.8.8', 6), false);
    });
  });
});

describe('isBlockedIp — IPv4 mapped into IPv6', () => {
  // URL normalises [::ffff:127.0.0.1] to the hex form, which is the one a
  // check on the host of a parsed URL actually sees
  test('blocks the hex form of a mapped private address', () => {
    assert.equal(isBlockedIp('::ffff:7f00:1', 6), true); // 127.0.0.1
    assert.equal(isBlockedIp('::ffff:a00:5', 6), true); // 10.0.0.5
    assert.equal(isBlockedIp('::ffff:a9fe:a9fe', 6), true); // 169.254.169.254
  });

  test('allows the hex form of a mapped public address', () => {
    assert.equal(isBlockedIp('::ffff:808:808', 6), false); // 8.8.8.8
  });
});
