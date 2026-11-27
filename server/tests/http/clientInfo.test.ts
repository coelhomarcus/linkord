import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTrustedProxyHops } from '../../src/config/env.js';
import { rateLimitSubject, resolveClientIp } from '../../src/http/clientInfo.js';

describe('resolveClientIp', () => {
  it('ignores the header without a trusted proxy', () => {
    assert.equal(resolveClientIp(false, '1.1.1.1', '10.0.0.1'), '10.0.0.1');
  });

  it('falls back to the peer, then to a placeholder, when there is no usable header', () => {
    assert.equal(resolveClientIp(true, undefined, '10.0.0.1'), '10.0.0.1');
    assert.equal(resolveClientIp(true, '', '10.0.0.1'), '10.0.0.1');
    assert.equal(resolveClientIp(true, undefined, undefined), '?');
  });

  it('takes the single entry a lone proxy wrote', () => {
    assert.equal(resolveClientIp(true, '203.0.113.7', '10.0.0.1'), '203.0.113.7');
  });

  it('ignores what the caller prepended when the proxy appends instead of replacing', () => {
    assert.equal(resolveClientIp(true, '6.6.6.6, 203.0.113.7', '10.0.0.1'), '203.0.113.7');
    assert.equal(resolveClientIp(true, '6.6.6.6, 7.7.7.7, 203.0.113.7', '10.0.0.1'), '203.0.113.7');
  });

  it('counts the configured number of proxies from the right', () => {
    assert.equal(resolveClientIp(true, '6.6.6.6, 203.0.113.7, 198.51.100.2', '10.0.0.1', 2), '203.0.113.7');
  });

  it('uses the first entry when the proxies wrote fewer entries than the hops configured', () => {
    assert.equal(resolveClientIp(true, '203.0.113.7', '10.0.0.1', 3), '203.0.113.7');
  });
});

describe('rateLimitSubject', () => {
  it('keeps an IPv4 address whole', () => {
    assert.equal(rateLimitSubject('203.0.113.7'), '203.0.113.7');
    assert.notEqual(rateLimitSubject('203.0.113.7'), rateLimitSubject('203.0.113.8'));
  });

  it('cuts a full IPv6 address to its /64', () => {
    assert.equal(rateLimitSubject('2001:0db8:0000:0001:aaaa:bbbb:cccc:dddd'), '2001:db8:0:1::/64');
  });

  it('puts every address of one /64 in the same bucket, and a neighbouring /64 in another', () => {
    const subject = rateLimitSubject('2001:db8:0:1::1');
    assert.equal(rateLimitSubject('2001:db8:0:1:ffff:ffff:ffff:ffff'), subject);
    assert.equal(rateLimitSubject('2001:DB8:0:1:1234::'), subject);
    assert.notEqual(rateLimitSubject('2001:db8:0:2::1'), subject);
  });

  it('expands compressed IPv6 wherever the gap is', () => {
    assert.equal(rateLimitSubject('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(rateLimitSubject('::1'), '0:0:0:0::/64');
    assert.equal(rateLimitSubject('::'), '0:0:0:0::/64');
    assert.equal(rateLimitSubject('fe80::'), 'fe80:0:0:0::/64');
    assert.equal(rateLimitSubject('2001:db8:1:2:3::'), '2001:db8:1:2::/64');
  });

  it('counts an IPv4-mapped address as the IPv4 address it carries', () => {
    assert.equal(rateLimitSubject('::ffff:203.0.113.7'), '203.0.113.7');
    assert.equal(rateLimitSubject('::FFFF:cb00:7107'), '203.0.113.7');
    assert.equal(rateLimitSubject('0:0:0:0:0:ffff:203.0.113.7'), '203.0.113.7');
  });

  it('does not mistake other addresses with an IPv4 tail for IPv4', () => {
    assert.equal(rateLimitSubject('64:ff9b::203.0.113.7'), '64:ff9b:0:0::/64');
    assert.equal(rateLimitSubject('::203.0.113.7'), '0:0:0:0::/64');
  });

  it('drops a zone id', () => {
    assert.equal(rateLimitSubject('fe80::1%eth0'), 'fe80:0:0:0::/64');
    assert.equal(rateLimitSubject('fe80::2%en1'), rateLimitSubject('fe80::1%eth0'));
  });

  it('leaves anything that is not an address as its own bucket', () => {
    assert.equal(rateLimitSubject('?'), '?');
    assert.equal(rateLimitSubject('not-an-ip'), 'not-an-ip');
  });
});

describe('parseTrustedProxyHops', () => {
  it('defaults to one proxy when unset or blank', () => {
    assert.equal(parseTrustedProxyHops(undefined), 1);
    assert.equal(parseTrustedProxyHops('  '), 1);
  });

  it('reads a whole number of proxies', () => {
    assert.equal(parseTrustedProxyHops(' 2 '), 2);
  });

  it('refuses anything else, naming the variable', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '2 proxies']) {
      assert.throws(() => parseTrustedProxyHops(bad), /TRUSTED_PROXY_HOPS/, bad);
    }
  });
});
