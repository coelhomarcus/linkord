import { describe, expect, it } from 'vitest';
import { buildRows, buildSections, searchItems } from '@/features/emoji/emojiPickerModel';
import { testEmojiData } from '@tests/fixtures/emojiDataFixture';

const party = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'party_cat', animated: true, serverId: 's1' };
const base = { data: testEmojiData, servers: [], addableServerIds: new Set<string>(), serverOrder: [], frequent: [], skinTone: 0, allowCustom: true };

describe('buildSections', () => {
  it('orders frequently used, servers, then categories (smileys and people together)', () => {
    const sections = buildSections({ ...base, servers: [{ serverId: 's1', emojis: [party] }], frequent: ['🐶', 'custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'gone'] });
    expect(sections.map((s) => s.key)).toEqual(['frequent', 'server:s1', 'people', 'nature', 'food']);
    expect(sections[0]!.items.map((i) => i.key)).toEqual(['🐶', 'custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
    expect(sections[2]!.items.map((i) => i.emoji)).toEqual(['😀', '😆', '😂', '🤣', '👋']);
  });

  it('shows a server the person may add to even with no emojis yet', () => {
    const sections = buildSections({ ...base, addableServerIds: new Set(['s2']), serverOrder: ['s2'] });
    expect(sections[0]).toMatchObject({ kind: 'server', serverId: 's2', items: [], canAdd: true });
  });

  it('leaves server emojis out when they don\'t fit, frequent ones included', () => {
    const sections = buildSections({ ...base, servers: [{ serverId: 's1', emojis: [party] }], frequent: ['custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], allowCustom: false });
    expect(sections.map((s) => s.key)).toEqual(['people', 'nature', 'food']);
  });

  it('shows frequent toned emojis in the tone picked now, once', () => {
    const sections = buildSections({ ...base, frequent: ['👋🏻', '👋🏿'], skinTone: 2 });
    expect(sections[0]!.items.map((i) => i.emoji)).toEqual(['👋🏼']);
  });
});

describe('buildRows', () => {
  it('cuts each section into rows of the column count, with its header first', () => {
    const rows = buildRows(buildSections(base), 2, new Set());
    expect(rows.map((r) => (r.kind === 'header' ? `#${r.section.key}` : r.items.length))).toEqual(['#people', 2, 2, 1, '#nature', 1, '#food', 1]);
  });

  it('keeps only the header of a collapsed section', () => {
    const rows = buildRows(buildSections(base), 9, new Set(['people']));
    expect(rows[0]).toMatchObject({ kind: 'header', collapsed: true });
    expect(rows[1]).toMatchObject({ kind: 'header', section: { key: 'nature' } });
  });

  it('gives an addable server a last cell for its add tile', () => {
    const rows = buildRows(buildSections({ ...base, servers: [{ serverId: 's1', emojis: [party] }], addableServerIds: new Set(['s1']) }), 1, new Set());
    expect(rows.slice(0, 3).map((r) => (r.kind === 'emojis' ? [r.items.length, r.withAdd] : 'header'))).toEqual(['header', [1, false], [0, true]]);
  });
});

describe('searchItems', () => {
  it('matches names, shortcodes and keywords, word starts first, accents aside', () => {
    expect(searchItems('dog', testEmojiData, [], 0, true).map((i) => i.emoji)).toEqual(['🐶', '🌭']);
    expect(searchItems('hello', testEmojiData, [], 0, true).map((i) => i.emoji)).toEqual(['👋']);
    expect(searchItems(':joy:', testEmojiData, [], 0, true).map((i) => i.emoji)).toEqual(['😂']);
  });

  it('finds server emojis by name', () => {
    expect(searchItems('cat', testEmojiData, [{ serverId: 's1', emojis: [party] }], 0, true).map((i) => i.key)).toEqual(['custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
    expect(searchItems('cat', testEmojiData, [{ serverId: 's1', emojis: [party] }], 0, false)).toEqual([]);
  });
});
