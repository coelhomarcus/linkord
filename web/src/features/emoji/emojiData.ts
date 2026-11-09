import { useEffect, useState } from 'react';
import { i18n } from '@/shared/i18n/init';

// Built from emojibase-data by web/scripts/buildEmojiData.mjs and served by
// us (public/emoji-data/<lang>/emojis.json), never by a CDN. ~60 KB gzipped,
// fetched the first time something needs it: the picker opening, or ":" plus
// two letters in the composer.

export interface EmojiEntry {
  emoji: string;
  label: string;
  /** emojibase's group number (see EMOJI_CATEGORIES) */
  group: number;
  /** English, Discord-style, the first one being what we show */
  shortcodes: string[];
  tags: string[];
  /** the five single-tone variants, light to dark */
  skins?: string[];
}

export interface EmojiData {
  emojis: EmojiEntry[];
  byShortcode: Map<string, EmojiEntry>;
  /** every variant (skin tones included) to its base entry */
  byEmoji: Map<string, EmojiEntry>;
}

type RawEntry = [string, string, number, string[], string[], string[]?];

export type EmojiDataLang = 'pt' | 'en';

function emojiDataLang(language: string | undefined = i18n.language): EmojiDataLang {
  return language?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

export function buildEmojiData(raw: RawEntry[]): EmojiData {
  const emojis: EmojiEntry[] = [];
  const byShortcode = new Map<string, EmojiEntry>();
  const byEmoji = new Map<string, EmojiEntry>();
  for (const [emoji, label, group, shortcodes, tags, skins] of raw) {
    const entry: EmojiEntry = { emoji, label, group, shortcodes, tags, skins };
    emojis.push(entry);
    for (const code of shortcodes) if (!byShortcode.has(code)) byShortcode.set(code, entry);
    byEmoji.set(emoji, entry);
    // an emoji with its VS16 dropped is still the same emoji
    byEmoji.set(emoji.replace(/️/g, ''), entry);
    for (const skin of skins ?? []) byEmoji.set(skin, entry);
  }
  return { emojis, byShortcode, byEmoji };
}

const loads = new Map<EmojiDataLang, Promise<EmojiData>>();
const loaded = new Map<EmojiDataLang, EmojiData>();

function loadEmojiData(lang: EmojiDataLang = emojiDataLang()): Promise<EmojiData> {
  let pending = loads.get(lang);
  if (!pending) {
    pending = fetch(`/emoji-data/${lang}/emojis.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`emoji data ${res.status}`);
        return res.json() as Promise<{ emojis: RawEntry[] }>;
      })
      .then(({ emojis }) => {
        const data = buildEmojiData(emojis);
        loaded.set(lang, data);
        return data;
      });
    // a failed fetch is forgotten, so the next use tries again
    pending.catch(() => loads.delete(lang));
    loads.set(lang, pending);
  }
  return pending;
}

/** The dataset once `enabled` has asked for it; null until it arrives. */
export function useEmojiData(enabled = true): EmojiData | null {
  const lang = emojiDataLang();
  const [, setArrived] = useState(0);
  useEffect(() => {
    if (!enabled || loaded.has(lang)) return;
    let cancelled = false;
    loadEmojiData(lang).then(() => { if (!cancelled) setArrived((n) => n + 1); }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled, lang]);
  return loaded.get(lang) ?? null;
}

/** For tests: start from a dataset without fetching. */
export function primeEmojiData(data: EmojiData, lang: EmojiDataLang = emojiDataLang()): void {
  loaded.set(lang, data);
  loads.set(lang, Promise.resolve(data));
}
