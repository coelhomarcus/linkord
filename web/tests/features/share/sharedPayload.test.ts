import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from '@tests/fixtures/fakeCacheStorage';
import {
  SHARE_CACHE, SHARE_TTL_MS, composeSharedText, discardSharedPayload, isShareId, readSharedPayload, sweepExpiredShares,
} from '@/features/share/sharedPayload';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const url = (id: string, part: string) => `${window.location.origin}/share-target/${id}/${part}`;

async function store(caches: FakeCacheStorage, id: string, meta: object, files: string[] = []) {
  const cache = await caches.open(SHARE_CACHE);
  await cache.put(url(id, 'meta'), new Response(JSON.stringify(meta)));
  for (const [index, body] of files.entries()) await cache.put(url(id, `file/${index}`), new Response(body));
}

describe('shared payload', () => {
  let caches: FakeCacheStorage;
  beforeEach(() => {
    caches = new FakeCacheStorage();
    vi.stubGlobal('caches', caches);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rebuilds the shared files with their name, type and text', async () => {
    await store(caches, ID, {
      createdAt: Date.now(), title: '', text: 'olha', url: '', files: [{ name: 'a.txt', type: 'text/plain', lastModified: 5 }],
    }, ['conteudo']);

    const payload = await readSharedPayload(ID);

    expect(payload?.text).toBe('olha');
    expect(payload?.files).toHaveLength(1);
    expect(payload?.files[0]).toMatchObject({ name: 'a.txt', type: 'text/plain', lastModified: 5 });
    expect(await payload!.files[0]!.text()).toBe('conteudo');
  });

  it('finds nothing for an unknown, malformed or expired id, or one missing a file', async () => {
    await store(caches, ID, { createdAt: Date.now() - SHARE_TTL_MS - 1, title: '', text: 't', url: '', files: [] });
    await store(caches, OTHER_ID, { createdAt: Date.now(), title: '', text: '', url: '', files: [{ name: 'x', type: '', lastModified: 0 }] });

    expect(await readSharedPayload(ID)).toBeNull();
    expect(await readSharedPayload(OTHER_ID)).toBeNull();
    expect(await readSharedPayload('3b241101-e2bb-4255-8caf-4136c566a962')).toBeNull();
    expect(await readSharedPayload('../meta')).toBeNull();
    expect(isShareId('../meta')).toBe(false);
  });

  it('puts the title, text and link on separate lines without repeating what the text already holds', () => {
    expect(composeSharedText({ title: 'Página', text: 'veja', url: 'https://a.test/x' })).toBe('Página\nveja\nhttps://a.test/x');
    expect(composeSharedText({ title: '', text: 'veja https://a.test/x', url: 'https://a.test/x' })).toBe('veja https://a.test/x');
    expect(composeSharedText({ title: 'Página', text: 'Página', url: '' })).toBe('Página');
    expect(composeSharedText({ title: ' ', text: '', url: '' })).toBe('');
  });

  it('discards only the files of the share it was asked about', async () => {
    await store(caches, ID, { createdAt: Date.now(), title: '', text: '', url: '', files: [{ name: 'a', type: '', lastModified: 0 }] }, ['a']);
    await store(caches, OTHER_ID, { createdAt: Date.now(), title: '', text: 'fica', url: '', files: [] });

    await discardSharedPayload(ID);

    expect(caches.entries(SHARE_CACHE)).toEqual([url(OTHER_ID, 'meta')]);
  });

  it('sweeps the shares past their time limit and keeps the fresh ones', async () => {
    await store(caches, ID, { createdAt: Date.now() - SHARE_TTL_MS - 1, title: '', text: 'velho', url: '', files: [] });
    await store(caches, OTHER_ID, { createdAt: Date.now(), title: '', text: 'novo', url: '', files: [] });

    await sweepExpiredShares();

    expect(caches.entries(SHARE_CACHE)).toEqual([url(OTHER_ID, 'meta')]);
  });

  it('does nothing where Cache Storage is missing', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await readSharedPayload(ID)).toBeNull();
    await expect(discardSharedPayload(ID)).resolves.toBeUndefined();
    await expect(sweepExpiredShares()).resolves.toBeUndefined();
  });
});
