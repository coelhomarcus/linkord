import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchMyAnimeList } from '../../../src/integrations/myanimelist/myanimelist.js';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';

const entry = (id: number, extra: Record<string, unknown> = {}) => ({
  node: { id, title: `Anime ${id}`, main_picture: { medium: 'https://cdn.myanimelist.net/images/test.jpg' }, ...extra },
});
describe('MyAnimeList adapter', () => {
  it('reads the eight most recent list entries from the official API with the client ID header', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const snapshot = await fetchMyAnimeList('Xinil', async (url, init) => {
      calls.push({ url, init });
      return { data: Array.from({ length: 15 }, (_, id) => entry(id + 1)) };
    }, 'client-id');
    assert.equal(calls.length, 1);
    const url = new URL(calls[0]!.url);
    assert.equal(url.origin + url.pathname, 'https://api.myanimelist.net/v2/users/Xinil/animelist');
    assert.equal(url.searchParams.get('sort'), 'list_updated_at');
    assert.equal(url.searchParams.get('limit'), '8');
    assert.deepEqual(calls[0]!.init?.headers, { 'X-MAL-CLIENT-ID': 'client-id' });
    const recent = snapshot.widgets['mal-recent-anime'];
    if (recent?.kind !== 'list') return assert.fail('missing recent activity');
    assert.equal(recent.items.length, 8);
    assert.deepEqual(recent.items.slice(0, 2).map((item) => item.id), ['1', '2']);
    assert.deepEqual(recent.items[0], {
      id: '1', title: 'Anime 1', url: 'https://myanimelist.net/anime/1', imageUrl: 'https://cdn.myanimelist.net/images/test.jpg',
    });
    assert.deepEqual(Object.keys(snapshot.widgets), ['mal-recent-anime']);
  });
  it('ignores cover images from other hosts', async () => {
    const snapshot = await fetchMyAnimeList('Xinil', async () => ({ data: [entry(7, { main_picture: { medium: 'https://example.com/a.jpg' } })] }), 'client-id');
    const recent = snapshot.widgets['mal-recent-anime'];
    if (recent?.kind !== 'list') return assert.fail('missing recent activity');
    assert.equal(recent.items[0]?.imageUrl, null);
  });
  it('rejects incomplete payloads instead of replacing a valid snapshot with partial data', async () => {
    await assert.rejects(fetchMyAnimeList('Xinil', async () => ({}), 'client-id'), ConnectionFetchError);
    await assert.rejects(fetchMyAnimeList('Xinil', async () => ({ data: [{ node: { id: 1 } }] }), 'client-id'), ConnectionFetchError);
  });
  it('accepts an empty public list', async () => {
    const snapshot = await fetchMyAnimeList('Xinil', async () => ({ data: [] }), 'client-id');
    assert.deepEqual(snapshot.widgets['mal-recent-anime'], { kind: 'list', items: [] });
  });
  it('is unavailable without a client ID and makes no request', async () => {
    await assert.rejects(fetchMyAnimeList('Xinil', async () => assert.fail('must not request'), ''), (error: ConnectionFetchError) => error.code === 'unavailable');
  });
});
