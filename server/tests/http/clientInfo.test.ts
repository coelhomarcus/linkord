import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTrustedProxyHops } from '../../src/config/env.js';
import { resolveClientIp } from '../../src/http/clientInfo.js';

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
