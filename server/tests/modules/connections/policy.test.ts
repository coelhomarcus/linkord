import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseConnection, retryDelay, SYNC_INTERVAL_MS } from '../../../src/modules/connections/policy.js';

describe('connection validation', () => {
  it('accepts public provider usernames and constructs canonical profile links', () => {
    assert.deepEqual(parseConnection('myanimelist', ' Xinil '), { provider: 'myanimelist', value: 'Xinil', url: 'https://myanimelist.net/profile/Xinil' });
    assert.equal(parseConnection('github', 'octocat')?.url, 'https://github.com/octocat');
    for (const value of ['https://github.com/user', '../admin', '-user', 'user-', 'a--b', 'a'.repeat(40)]) assert.equal(parseConnection('github', value), null);
    for (const value of ['user/name', 'a', 'a'.repeat(17)]) assert.equal(parseConnection('myanimelist', value), null);
  });
  it('accepts HTTP links without fetching and rejects executable or credentialed URLs', () => {
    assert.equal(parseConnection('url', 'https://example.com/page')?.value, 'https://example.com/page');
    for (const value of ['javascript:alert(1)', 'data:text/html,abc', 'file:///etc/passwd', 'https://user:secret@example.com', 'https://example.com/a b', 'http:example.com', 'invalid']) assert.equal(parseConnection('url', value), null);
    assert.equal(parseConnection('unknown', 'user'), null);
    assert.equal(parseConnection('github', {}), null);
  });
  it('backs off transient failures and respects a longer provider cooldown', () => {
    assert.equal(retryDelay(0), 60_000);
    assert.equal(retryDelay(3), 8 * 60_000);
    assert.equal(retryDelay(100), SYNC_INTERVAL_MS);
    assert.equal(retryDelay(0, SYNC_INTERVAL_MS * 2), SYNC_INTERVAL_MS * 2);
  });
});
