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

describe('isBlockedIp — IPv6 special-purpose ranges', () => {
  // [range, first address, last address, just below, just above]; null where
  // the neighbour is itself in another blocked range or doesn't exist
  const ranges: Array<[string, string, string, string | null, string | null]> = [
    ['::/96 (unspecified, loopback, IPv4-compatible)', '::', '::ffff:ffff', null, null],
    ['64:ff9b:1::/48 (local-use NAT64)', '64:ff9b:1::', '64:ff9b:1:ffff:ffff:ffff:ffff:ffff', '64:ff9b:0:ffff:ffff:ffff:ffff:ffff', '64:ff9b:2::'],
    ['100::/64 (discard)', '100::', '100::ffff:ffff:ffff:ffff', 'ff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '100:0:0:1::'],
    ['2001::/32 (Teredo)', '2001::', '2001:0:ffff:ffff:ffff:ffff:ffff:ffff', '2000:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '2001:1::'],
    ['2001:db8::/32 (documentation)', '2001:db8::', '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db7:ffff:ffff:ffff:ffff:ffff:ffff', '2001:db9::'],
    ['fc00::/7 (unique local)', 'fc00::', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', null],
    ['fe80::/10 (link-local)', 'fe80::', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', null, null],
    ['fec0::/10 (site-local)', 'fec0::', 'feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', null, null],
    ['ff00::/8 (multicast)', 'ff00::', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', null, null],
  ];
  for (const [name, first, last, below, above] of ranges) {
    test(`blocks the first and last address of ${name}`, () => {
      assert.equal(isBlockedIp(first, 6), true, first);
      assert.equal(isBlockedIp(last, 6), true, last);
    });
    for (const outside of [below, above]) {
      if (outside) test(`does not block ${outside}, just outside ${name}`, () => assert.equal(isBlockedIp(outside, 6), false));
    }
  }

  test('fe00::/9, between fc00::/7 and fe80::/10, is not special-purpose', () => {
    assert.equal(isBlockedIp('fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 6), false);
  });

  describe('embedded IPv4 is judged by the IPv4 rules', () => {
    const cases: Array<[string, string, string, boolean]> = [
      ['NAT64 64:ff9b::/96', '64:ff9b::7f00:1', '127.0.0.1', true],
      ['NAT64 64:ff9b::/96', '64:ff9b::a9fe:a9fe', '169.254.169.254', true],
      ['NAT64 64:ff9b::/96', '64:ff9b::808:808', '8.8.8.8', false],
      ['NAT64 64:ff9b::/96', '64:ff9b::10.0.0.1', '10.0.0.1', true],
      ['6to4 2002::/16', '2002:7f00:1::1', '127.0.0.1', true],
      ['6to4 2002::/16', '2002:c0a8:101:1::1', '192.168.1.1', true],
      ['6to4 2002::/16', '2002:808:808::1', '8.8.8.8', false],
      ['IPv4-mapped ::ffff:0:0/96', '::ffff:0:0', '0.0.0.0', true],
      ['IPv4-mapped ::ffff:0:0/96', '::ffff:808:808', '8.8.8.8', false],
    ];
    for (const [range, ip, v4, blocked] of cases) {
      test(`${range}: ${ip} (${v4}) is ${blocked ? 'blocked' : 'allowed'}`, () => assert.equal(isBlockedIp(ip, 6), blocked));
    }

    test('NAT64 boundary: the address after 64:ff9b::/96 is not unwrapped', () => {
      assert.equal(isBlockedIp('64:ff9b:0:0:0:1::', 6), false);
      assert.equal(isBlockedIp('64:ff9a:ffff:ffff:ffff:ffff:ffff:ffff', 6), false);
    });

    test('6to4 boundary: the addresses around 2002::/16 are not unwrapped', () => {
      assert.equal(isBlockedIp('2001:ffff:7f00:1::1', 6), false);
      assert.equal(isBlockedIp('2003:7f00:1::1', 6), false);
    });
  });

  test('a zone id does not hide a link-local address', () => {
    assert.equal(isBlockedIp('fe80::1%eth0', 6), true);
    assert.equal(isBlockedIp('fe90::1%25eth0', 6), true);
  });

  test('a malformed IPv6 address is blocked for safety (fail closed)', () => {
    assert.equal(isBlockedIp('not-an-ip', 6), true);
    assert.equal(isBlockedIp('1:2:3:4:5:6:7:8:9', 6), true);
  });

  test('ordinary public IPv6 is still allowed', () => {
    assert.equal(isBlockedIp('2001:4860:4860::8888', 6), false);
    assert.equal(isBlockedIp('2a03:2880:f12f:83:face:b00c:0:25de', 6), false);
  });
});
