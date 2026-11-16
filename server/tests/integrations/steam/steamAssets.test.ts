import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { steamClientIconUrl, steamCommunityIconUrl } from '../../../src/integrations/steam/steamAssets.js';

describe('Steam asset addresses', () => {
  it('builds the client and community icon URLs on Steam\'s CDN', () => {
    const hash = '2e048bfc2073ca30804ed5b8c454a9ca0e2f98de';
    assert.equal(steamClientIconUrl(1245620, hash), `https://shared.fastly.steamstatic.com/community_assets/images/apps/1245620/${hash}.ico`);
    assert.equal(steamCommunityIconUrl(1245620, hash), `https://shared.fastly.steamstatic.com/community_assets/images/apps/1245620/${hash}.jpg`);
  });

  it('builds nothing from a bad id or hash', () => {
    assert.equal(steamClientIconUrl(0, 'a'.repeat(40)), null);
    assert.equal(steamClientIconUrl(570, '../../x'), null);
    assert.equal(steamCommunityIconUrl(570, 'A'.repeat(40)), null);
  });
});
