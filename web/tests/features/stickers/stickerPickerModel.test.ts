import { describe, expect, it } from 'vitest';
import { buildStickerSections, MAX_STICKERS_PER_SERVER, stickerMatches } from '@/features/stickers/stickerPickerModel';
import type { MySticker } from '@/features/stickers/myStickers';

const sticker = (id: string, serverId: string, over: Partial<MySticker> = {}): MySticker => ({
  id, serverId, name: `figurinha ${id}`, description: '', emoji: '😺', animated: false, ...over,
});

const hug = sticker('a', 's1', { name: 'Abraço de gato', description: 'dois gatos', emoji: '🤗' });
const wave = sticker('b', 's2', { name: 'tchau' });
const groups = [{ serverId: 's1', stickers: [hug] }, { serverId: 's2', stickers: [wave] }];
const byId = new Map([hug, wave].map((s) => [s.id, s]));
const base = { groups, byId, frequent: [] as string[], query: '', serverOrder: ['s2', 's1'], addableServerIds: new Set<string>() };

describe('stickerMatches', () => {
  it('finds a sticker by its name without accents, its description, or its emoji', () => {
    expect(stickerMatches(hug, 'abraco')).toBe(true);
    expect(stickerMatches(hug, 'GATOS')).toBe(true);
    expect(stickerMatches(hug, '🤗')).toBe(true);
    expect(stickerMatches(hug, 'tchau')).toBe(false);
  });
});

describe('buildStickerSections', () => {
  it('lists the frequently used first, then each server in the rail order', () => {
    const sections = buildStickerSections({ ...base, frequent: ['b', 'gone'] });
    expect(sections.map((s) => (s.kind === 'server' ? s.serverId : s.kind))).toEqual(['frequent', 's2', 's1']);
    // a sticker deleted since is skipped
    expect(sections[0]!.stickers).toEqual([wave]);
  });

  it('is one list of what matches while searching', () => {
    expect(buildStickerSections({ ...base, query: 'gato' })).toEqual([{ kind: 'results', stickers: [hug], withAdd: false }]);
    expect(buildStickerSections({ ...base, query: 'nada' })).toEqual([]);
  });

  it('offers adding to a server the account may add to, until it is full, even before it has any', () => {
    const sections = buildStickerSections({ ...base, serverOrder: ['s1', 's3'], addableServerIds: new Set(['s1', 's3']) });
    expect(sections).toEqual([
      { kind: 'server', serverId: 's1', stickers: [hug], withAdd: true },
      { kind: 'server', serverId: 's3', stickers: [], withAdd: true },
    ]);
    const full = Array.from({ length: MAX_STICKERS_PER_SERVER }, (_, i) => sticker(`f${i}`, 's1'));
    const [s1] = buildStickerSections({ ...base, groups: [{ serverId: 's1', stickers: full }], serverOrder: ['s1'], addableServerIds: new Set(['s1']) });
    expect(s1).toMatchObject({ withAdd: false });
  });
});
