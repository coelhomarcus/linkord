import type { EmojiData, EmojiEntry } from './emojiData';

export interface ShortcodeSuggestion {
  /** what "frequently used" counts it by: the emoji itself */
  key: string;
  emoji: string;
  /** the shortcode that matched, shown as :shortcode: */
  shortcode: string;
}

interface Candidate<T> {
  item: T;
  names: string[];
  key: string;
  order: number;
}

interface Ranked<T> {
  item: T;
  name: string;
  tier: number;
  frequency: number;
  order: number;
}

/** Ranks things by name against `query`: an exact name first, then names
 * starting with it, then names containing it; within each, what the account
 * uses most, then the dataset's own order. */
export function rankByName<T>(query: string, candidates: Iterable<Candidate<T>>, frequent: readonly string[], limit: number): { item: T; name: string }[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const rank = new Map(frequent.map((key, i) => [key, i]));
  const hits: Ranked<T>[] = [];
  for (const candidate of candidates) {
    let best: { name: string; tier: number } | null = null;
    for (const name of candidate.names) {
      const tier = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : -1;
      if (tier !== -1 && (!best || tier < best.tier)) best = { name, tier };
      if (tier === 0) break;
    }
    if (best) hits.push({ item: candidate.item, name: best.name, tier: best.tier, frequency: rank.get(candidate.key) ?? Infinity, order: candidate.order });
  }
  hits.sort((a, b) => a.tier - b.tier || a.frequency - b.frequency || a.order - b.order);
  return hits.slice(0, limit).map(({ item, name }) => ({ item, name }));
}

function* unicodeCandidates(data: EmojiData): Generator<Candidate<EmojiEntry>> {
  let order = 0;
  for (const entry of data.emojis) {
    if (entry.shortcodes.length) yield { item: entry, names: entry.shortcodes, key: entry.emoji, order: order++ };
  }
}

/** Shortcode matches for the composer's ":query", with the skin tone the
 * person picked applied to the emojis that have one. */
export function suggestShortcodes(query: string, data: EmojiData, frequent: readonly string[], limit = 8, skinTone = 0): ShortcodeSuggestion[] {
  // a frequently used toned variant ranks its base entry
  const baseFrequent = frequent.map((key) => data.byEmoji.get(key)?.emoji ?? key);
  return rankByName(query, unicodeCandidates(data), baseFrequent, limit).map(({ item, name }) => {
    const emoji = withSkinTone(item, skinTone);
    return { key: emoji, emoji, shortcode: name };
  });
}

/** `tone` 0 is the default (yellow) emoji, 1..5 light to dark. */
export function withSkinTone(entry: EmojiEntry, tone: number): string {
  return tone > 0 && entry.skins ? entry.skins[tone - 1] ?? entry.emoji : entry.emoji;
}
