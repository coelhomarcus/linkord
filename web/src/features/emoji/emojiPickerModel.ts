import type { EmojiData, EmojiEntry } from './emojiData';
import { withSkinTone } from './emojiSearch';
import { customReactionId, customReactionKey } from './customEmojiText';
import type { CustomEmoji, ServerEmojiGroup } from './myEmojis';

// The picker's content as plain data: sections, then the rows a virtualized
// list draws (a header, or up to `columns` emojis). Kept apart from the
// component so what goes where can be tested without rendering it.

/** Discord's categories, over emojibase's groups (smileys and people are one). */
const EMOJI_CATEGORIES = [
  { key: 'people', groups: [0, 1] },
  { key: 'nature', groups: [3] },
  { key: 'food', groups: [4] },
  { key: 'activities', groups: [6] },
  { key: 'travel', groups: [5] },
  { key: 'objects', groups: [7] },
  { key: 'symbols', groups: [8] },
  { key: 'flags', groups: [9] },
] as const;

export type EmojiCategoryKey = (typeof EMOJI_CATEGORIES)[number]['key'];

export interface PickerItem {
  /** what "frequently used" and reactions call it: the emoji, or custom:<id> */
  key: string;
  emoji?: string;
  custom?: CustomEmoji;
  /** shown as :shortcode: */
  shortcode: string;
  /** what a screen reader says */
  label: string;
}

export type PickerSection =
  | { kind: 'frequent'; key: 'frequent'; items: PickerItem[] }
  | { kind: 'server'; key: string; serverId: string; items: PickerItem[]; canAdd: boolean }
  | { kind: 'category'; key: EmojiCategoryKey; items: PickerItem[] }
  | { kind: 'results'; key: 'results'; items: PickerItem[] };

export type PickerRow =
  | { kind: 'header'; section: PickerSection; collapsed: boolean }
  | { kind: 'emojis'; section: PickerSection; items: PickerItem[]; /** a server's last row may end with its "add" tile */ withAdd: boolean };

function unicodeItem(entry: EmojiEntry, skinTone: number): PickerItem {
  const emoji = withSkinTone(entry, skinTone);
  return { key: emoji, emoji, shortcode: entry.shortcodes[0] ?? entry.label.replace(/\s+/g, '_'), label: entry.label };
}

function customItem(emoji: CustomEmoji): PickerItem {
  return { key: customReactionKey(emoji.id), custom: emoji, shortcode: emoji.name, label: `:${emoji.name}:` };
}

interface BuildOptions {
  data: EmojiData | null;
  servers: readonly ServerEmojiGroup[];
  /** servers the person may add emojis to, even with none yet */
  addableServerIds: ReadonlySet<string>;
  /** the server-wide order of servers (the rail), for those with no emojis */
  serverOrder: readonly string[];
  frequent: readonly string[];
  skinTone: number;
  allowCustom: boolean;
  maxFrequent?: number;
}

/** Frequently used, one section per server (when server emojis are allowed
 * here), then the standard categories. */
export function buildSections({ data, servers, addableServerIds, serverOrder, frequent, skinTone, allowCustom, maxFrequent = 27 }: BuildOptions): PickerSection[] {
  const sections: PickerSection[] = [];
  const customById = new Map(servers.flatMap((group) => group.emojis.map((e) => [e.id, e] as const)));

  const frequentItems: PickerItem[] = [];
  for (const key of frequent) {
    if (frequentItems.length >= maxFrequent) break;
    const customId = customReactionId(key);
    if (customId) {
      const emoji = allowCustom ? customById.get(customId) : undefined;
      if (emoji) frequentItems.push(customItem(emoji));
      continue;
    }
    const entry = data?.byEmoji.get(key);
    // a toned use counts for the emoji, shown in the tone picked now
    if (entry && !frequentItems.some((item) => item.key === withSkinTone(entry, skinTone))) frequentItems.push(unicodeItem(entry, skinTone));
  }
  if (frequentItems.length) sections.push({ kind: 'frequent', key: 'frequent', items: frequentItems });

  if (allowCustom) {
    const withEmojis = new Map(servers.map((group) => [group.serverId, group]));
    const ordered = [...new Set([...servers.map((g) => g.serverId), ...serverOrder.filter((id) => addableServerIds.has(id))])];
    for (const serverId of ordered) {
      const group = withEmojis.get(serverId);
      const canAdd = addableServerIds.has(serverId);
      if (!group?.emojis.length && !canAdd) continue;
      sections.push({ kind: 'server', key: `server:${serverId}`, serverId, items: (group?.emojis ?? []).map(customItem), canAdd });
    }
  }

  if (data) {
    const byGroup = new Map<number, EmojiEntry[]>();
    for (const entry of data.emojis) {
      const list = byGroup.get(entry.group);
      if (list) list.push(entry); else byGroup.set(entry.group, [entry]);
    }
    for (const category of EMOJI_CATEGORIES) {
      const items = category.groups.flatMap((group) => byGroup.get(group) ?? []).map((entry) => unicodeItem(entry, skinTone));
      if (items.length) sections.push({ kind: 'category', key: category.key, items });
    }
  }
  return sections;
}

/** The rows to draw: each section's header, then its emojis in rows of
 * `columns` (none while it is collapsed). Results have no header. */
export function buildRows(sections: readonly PickerSection[], columns: number, collapsed: ReadonlySet<string>): PickerRow[] {
  const rows: PickerRow[] = [];
  for (const section of sections) {
    const isCollapsed = section.kind !== 'results' && collapsed.has(section.key);
    if (section.kind !== 'results') rows.push({ kind: 'header', section, collapsed: isCollapsed });
    if (isCollapsed) continue;
    const canAdd = section.kind === 'server' && section.canAdd;
    // the add tile takes a cell of its own after the last emoji
    const cells = section.items.length + (canAdd ? 1 : 0);
    for (let start = 0; start < cells; start += columns) {
      const items = section.items.slice(start, start + columns);
      rows.push({ kind: 'emojis', section, items, withAdd: canAdd && start + columns >= cells });
    }
  }
  return rows;
}

function words(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[\s_:-]+/).filter(Boolean);
}

/** Search across names, shortcodes and keywords: whole-word starts first,
 * then anything containing the query. Accents don't count. */
export function searchItems(query: string, data: EmojiData | null, servers: readonly ServerEmojiGroup[], skinTone: number, allowCustom: boolean, limit = 200): PickerItem[] {
  const q = query.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^:|:$/g, '');
  if (!q) return [];
  const starts: PickerItem[] = [];
  const contains: PickerItem[] = [];
  const consider = (item: PickerItem, haystack: string[]) => {
    if (haystack.some((word) => word.startsWith(q))) starts.push(item);
    else if (haystack.some((word) => word.includes(q))) contains.push(item);
  };
  if (allowCustom) {
    for (const group of servers) for (const emoji of group.emojis) consider(customItem(emoji), [emoji.name, ...words(emoji.name)]);
  }
  for (const entry of data?.emojis ?? []) {
    consider(unicodeItem(entry, skinTone), [...entry.shortcodes, ...entry.shortcodes.flatMap(words), ...words(entry.label), ...entry.tags.flatMap(words)]);
  }
  return [...starts, ...contains].slice(0, limit);
}
