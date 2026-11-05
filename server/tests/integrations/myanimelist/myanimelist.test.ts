import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fetchMyAnimeList } from '../../../src/integrations/myanimelist/myanimelist.js';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';

const entry = (id: number) => ({ mal_id: id, title: `Anime ${id}`, images: { jpg: { image_url: 'https://cdn.myanimelist.net/images/test.jpg' } } });
describe('MyAnimeList adapter', () => {
  it('normalizes public favorites and recent progress, preserving provider order and capping lists', async () => {
    const paths: string[] = [];
    const snapshot = await fetchMyAnimeList('Xinil', async (url) => {
      paths.push(url);
      if (url.endsWith('/favorites')) return { data: { anime: Array.from({ length: 15 }, (_, id) => entry(id + 1)), manga: [], characters: [{ mal_id: 50, name: 'Character', images: {} }] } };
      if (url.endsWith('/userupdates')) return { data: { anime: [{ entry: entry(12), status: 'Watching', episodes_seen: 3, episodes_total: null }] } };
      return { data: { username: 'Xinil' } };
    });
    assert.equal(paths.length, 3);
    const favorites = snapshot.widgets['mal-favorite-anime'];
    assert.equal(favorites?.kind, 'list');
    if (favorites?.kind !== 'list') return;
    assert.equal(favorites.items.length, 10);
    assert.deepEqual(favorites.items.slice(0, 2).map((item) => item.id), ['1', '2']);
    const recent = snapshot.widgets['mal-recent-anime'];
    if (recent?.kind !== 'list') return assert.fail('missing recent activity');
    assert.equal(recent.items[0]?.progress, 3);
    assert.equal(recent.items[0]?.total, null);
    assert.equal(snapshot.widgets['mal-favorite-manga']?.kind, 'list');
  });
  it('rejects incomplete payloads instead of replacing a valid snapshot with partial data', async () => {
    await assert.rejects(fetchMyAnimeList('Xinil', async (url) => url.endsWith('/favorites') ? { data: {} } : { data: { username: 'Xinil' } }), ConnectionFetchError);
  });
  it('accepts empty public collections and missing images', async () => {
    const snapshot = await fetchMyAnimeList('Xinil', async (url) => url.endsWith('/favorites') ? { data: { anime: [], manga: [], characters: [] } } : url.endsWith('/userupdates') ? { data: { anime: [] } } : { data: { username: 'Xinil' } });
    assert.deepEqual(snapshot.widgets['mal-recent-anime'], { kind: 'list', items: [] });
  });
});
