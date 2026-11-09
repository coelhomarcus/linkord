import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { withProxiedImages } from '../../../src/modules/connections/widgetImages.js';
import { setMediaProxyKey } from '../../../src/modules/media-proxy/mediaProxyUrls.js';

describe('widget pictures', () => {
  before(() => setMediaProxyKey(crypto.randomBytes(32)));
  after(() => setMediaProxyKey(null));

  it('sends the anime covers and the GitHub avatar through our proxy', () => {
    const list = withProxiedImages({ kind: 'list', items: [
      { id: '1', title: 'Bebop', url: 'https://myanimelist.net/anime/1', imageUrl: 'https://cdn.myanimelist.net/images/anime/1/2.jpg' },
      { id: '2', title: 'No cover', url: 'https://myanimelist.net/anime/2', imageUrl: null },
    ] });
    assert.equal(list.kind, 'list');
    if (list.kind !== 'list') return;
    assert.match(list.items[0]!.imageUrl!, /^\/api\/media-proxy\/mal\//);
    assert.equal(list.items[0]!.url, 'https://myanimelist.net/anime/1');
    assert.equal(list.items[1]!.imageUrl, null);

    const profile = withProxiedImages({ kind: 'github-profile', login: 'octocat', name: null, avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', repositories: 1, followers: 2, following: 3 });
    assert.ok(profile.kind === 'github-profile' && profile.avatarUrl?.startsWith('/api/media-proxy/github/'));
  });

  it('drops a stored picture from another host rather than sending it as is', () => {
    const list = withProxiedImages({ kind: 'list', items: [{ id: '1', title: 'x', url: 'https://myanimelist.net/anime/1', imageUrl: 'https://attacker.example/x.png' }] });
    assert.ok(list.kind === 'list' && list.items[0]!.imageUrl === null);
  });

  it('leaves the calendar alone', () => {
    const calendar = { kind: 'github-calendar' as const, total: 0, days: [] };
    assert.equal(withProxiedImages(calendar), calendar);
  });
});
