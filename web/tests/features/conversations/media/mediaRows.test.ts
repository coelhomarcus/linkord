import { describe, expect, it } from 'vitest';
import type { MediaItem } from '@/shared/api/api';
import { buildRows, dateGroupLabel, itemKey, layoutFor } from '@/features/conversations/media/mediaRows';

// Wednesday, 28 Oct 2026, noon local time
const NOW = new Date(2026, 9, 28, 12).getTime();
const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 28 - daysAgo, hour).getTime();

function item(msgId: number, ts: number, attachmentId = `a${msgId}`): MediaItem {
  return {
    msgId, conversationId: 'c1', conversationName: 'Grupo', authorId: 'u1', authorName: 'Ana', authorAvatar: '', authorAvatarColor: '', ts,
    attachment: { id: attachmentId, name: 'f.png', mime: 'image/png', size: 1 },
  };
}

describe('dateGroupLabel', () => {
  it('names today and yesterday, then the rest of the week', () => {
    expect(dateGroupLabel(at(0, 1), NOW)).toBe('Hoje');
    expect(dateGroupLabel(at(1, 23), NOW)).toBe('Ontem');
    expect(dateGroupLabel(at(2), NOW)).toBe('Esta semana');
    expect(dateGroupLabel(at(6), NOW)).toBe('Esta semana');
  });

  it('falls back to a capitalized month and year after a week', () => {
    expect(dateGroupLabel(at(7), NOW)).toBe('Outubro de 2026');
    expect(dateGroupLabel(new Date(2026, 8, 3).getTime(), NOW)).toBe('Setembro de 2026');
    expect(dateGroupLabel(new Date(2025, 11, 31).getTime(), NOW)).toBe('Dezembro de 2025');
  });

  it('treats a timestamp ahead of the clock as today', () => {
    expect(dateGroupLabel(NOW + 3 * 3_600_000, NOW)).toBe('Hoje');
  });
});

describe('layoutFor', () => {
  it('picks a layout that fits what the tab holds', () => {
    expect(layoutFor('uploads')).toBe('tiles');
    expect(layoutFor('images')).toBe('tiles');
    expect(layoutFor('gifs')).toBe('tiles');
    expect(layoutFor('videos')).toBe('tiles');
    expect(layoutFor('audios')).toBe('list');
    expect(layoutFor('documents')).toBe('list');
    expect(layoutFor('embeds')).toBe('cards');
  });
});

describe('buildRows', () => {
  it('puts a heading wherever the day group changes', () => {
    const rows = buildRows([item(5, at(0)), item(4, at(1)), item(3, at(3)), item(2, at(40))], 'list', 4, NOW);
    expect(rows.map((r) => (r.type === 'header' ? r.label : r.type))).toEqual([
      'Hoje', 'item', 'Ontem', 'item', 'Esta semana', 'item', 'Setembro de 2026', 'item',
    ]);
  });

  it('cuts tiles into rows of the column count', () => {
    const rows = buildRows([5, 4, 3, 2, 1].map((id) => item(id, at(0))), 'tiles', 2, NOW);
    expect(rows.map((r) => (r.type === 'tiles' ? r.items.map((i) => i.msgId) : r.type))).toEqual([
      'header', [5, 4], [3, 2], [1],
    ]);
  });

  it('never lets a tile row straddle two headings', () => {
    const rows = buildRows([item(3, at(0)), item(2, at(1)), item(1, at(1))], 'tiles', 3, NOW);
    expect(rows.map((r) => (r.type === 'tiles' ? r.items.map((i) => i.msgId) : r.type))).toEqual([
      'header', [3], 'header', [2, 1],
    ]);
  });

  it('keeps unique row keys when one message has several attachments', () => {
    const rows = buildRows([item(7, at(0), 'x'), item(7, at(0), 'y')], 'list', 4, NOW);
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(itemKey(item(7, 0, 'x'))).not.toBe(itemKey(item(7, 0, 'y')));
  });

  it('is empty for no items', () => {
    expect(buildRows([], 'tiles', 4, NOW)).toEqual([]);
  });
});
