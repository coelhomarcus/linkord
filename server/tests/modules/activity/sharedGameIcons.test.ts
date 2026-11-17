import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sharedIconKey, withSharedIcons, type SharedIconSource } from '../../../src/modules/activity/sharedGameIcons.js';

const icon = (c: string) => `/api/activity/icons/${c.repeat(64)}.webp`;

function source(icons: Record<string, string>, asked: string[][] = []): SharedIconSource {
  return {
    async iconIds(keys) {
      asked.push(keys);
      return new Map(keys.flatMap((key) => (icons[key] ? [[key, icons[key]] as const] : [])));
    },
  };
}

describe('sharedIconKey', () => {
  test('is the key GET /api/activity/game stores the icon under', () => {
    assert.equal(sharedIconKey({ key: 'steam:570', kind: 'playing', name: 'Dota 2' }), 'steam:570');
    assert.equal(sharedIconKey({ key: 'counter-strike-2', kind: 'playing', name: '  Counter-Strike   2 ' }), 'name:counter-strike 2');
  });

  test('is null for an app, which has no game icon', () => {
    assert.equal(sharedIconKey({ key: 'spotify', kind: 'using', name: 'Spotify' }), null);
  });
});

describe('withSharedIcons', () => {
  test('replaces what each account reported with the game\'s own icon', async () => {
    const asked: string[][] = [];
    const items = [
      { key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: icon('a') },
      { key: 'other-pc', kind: 'playing', name: 'Minecraft', icon: null },
      { key: 'spotify', kind: 'using', name: 'Spotify', icon: icon('b') },
      { key: 'terraria', kind: 'playing', name: 'Terraria', icon: icon('e') },
    ];
    const shown = await withSharedIcons(items, source({ 'name:minecraft': 'c'.repeat(64) }, asked));
    assert.deepEqual(shown.map((item) => item.icon), [icon('c'), icon('c'), icon('b'), icon('e')]);
    assert.deepEqual(asked, [['name:minecraft', 'name:terraria']]);
    // what needs no change is the same object
    assert.equal(shown[2], items[2]);
  });

  test('asks nothing when there is no game', async () => {
    const asked: string[][] = [];
    await withSharedIcons([{ key: 'spotify', kind: 'using', name: 'Spotify', icon: null }], source({}, asked));
    assert.deepEqual(asked, []);
  });

  test('keeps the reported icons when the shared ones cannot be read', async () => {
    const failing: SharedIconSource = { async iconIds() { throw new Error('db down'); } };
    const original = console.error;
    console.error = () => {};
    try {
      const shown = await withSharedIcons([{ key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: icon('a') }], failing);
      assert.equal(shown[0]?.icon, icon('a'));
    } finally {
      console.error = original;
    }
  });
});
