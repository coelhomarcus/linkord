import type { EmojiData, EmojiEntry } from './emojiData';
import type { CustomEmoji } from './myEmojis';
import { customReactionKey } from './customEmojiText';

export interface ShortcodeSuggestion {
  /** what "frequently used" counts it by: the emoji itself, or custom:<id> */
  key: string;
  /** a Unicode emoji, or… */
  emoji?: string;
  /** …one of the account's server emojis */
  custom?: CustomEmoji;
  /** the shortcode that matched, shown as :shortcode: (`name~2` for the
   * second server emoji of a name) */
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

const UNICODE_ORDER_OFFSET = 1_000_000;

function compareRanked(a: Ranked<unknown>, b: Ranked<unknown>): number {
  return a.tier - b.tier || a.frequency - b.frequency || a.order - b.order;
}

/** Ranks things by name against `query`: an exact name first, then names
 * starting with it, then names containing it; within each, what the account
 * uses most, then the dataset's own order. */
function rankedByName<T>(query: string, candidates: Iterable<Candidate<T>>, frequent: readonly string[]): Ranked<T>[] {
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
  hits.sort(compareRanked);
  return hits;
}

function* unicodeCandidates(data: EmojiData): Generator<Candidate<EmojiEntry>> {
  let order = 0;
  for (const entry of data.emojis) {
    if (entry.shortcodes.length) yield { item: entry, names: entry.shortcodes, key: entry.emoji, order: order++ };
  }
}

function* customCandidates(byName: Map<string, CustomEmoji[]>): Generator<Candidate<CustomEmoji>> {
  let order = 0;
  for (const [name, emojis] of byName) {
    for (const [i, emoji] of emojis.entries()) {
      yield { item: emoji, names: [i === 0 ? name : `${name}~${i + 1}`], key: customReactionKey(emoji.id), order: order++ };
    }
  }
}

/** Shortcode matches for the composer's ":query": the Unicode dataset's
 * (with the person's skin tone applied) and the account's server emojis
 * (`byName`, see emojisByName), ranked together. */
export function suggestShortcodes(
  query: string,
  data: EmojiData | null,
  frequent: readonly string[],
  limit = 8,
  skinTone = 0,
  byName?: Map<string, CustomEmoji[]>,
): ShortcodeSuggestion[] {
  // a frequently used toned variant ranks its base entry
  const baseFrequent = data ? frequent.map((key) => data.byEmoji.get(key)?.emoji ?? key) : frequent;
  const unicode: Ranked<ShortcodeSuggestion>[] = data
    ? rankedByName(query, unicodeCandidates(data), baseFrequent).map((hit) => {
      const emoji = withSkinTone(hit.item, skinTone);
      // after any server emoji that ranks the same
      return { ...hit, order: hit.order + UNICODE_ORDER_OFFSET, item: { key: emoji, emoji, shortcode: hit.name } };
    })
    : [];
  const custom: Ranked<ShortcodeSuggestion>[] = byName
    ? rankedByName(query, customCandidates(byName), frequent).map((hit) => ({ ...hit, item: { key: customReactionKey(hit.item.id), custom: hit.item, shortcode: hit.name } }))
    : [];
  return [...custom, ...unicode].sort(compareRanked).slice(0, limit).map((hit) => hit.item);
}

/** `tone` 0 is the default (yellow) emoji, 1..5 light to dark. */
export function withSkinTone(entry: EmojiEntry, tone: number): string {
  return tone > 0 && entry.skins ? entry.skins[tone - 1] ?? entry.emoji : entry.emoji;
}
