import { graphemeSegmenter, isEmojiGrapheme } from '@/shared/lib/isSingleEmoji';

// Unicode emojis drawn as Twemoji pictures, the same on every system (a
// system font may lack the newest ones, draw a ZWJ sequence as two or three
// emojis, or a flag as two letters). The text keeps the real characters: the
// picture is only how they look.

/** Twemoji's file names: code points in hex, without FE0F unless the
 * sequence has a ZWJ (their own rule). */
function fileName(emoji: string, keepVariation: boolean): string {
  const points = [...emoji].map((char) => char.codePointAt(0)!);
  return points.filter((point) => keepVariation || point !== 0xfe0f).map((point) => point.toString(16)).join('-');
}

/** Where its picture may be, most likely first: a few sequences (👁️‍🗨️) are
 * named without FE0F even with a ZWJ. */
export function twemojiUrls(emoji: string): string[] {
  const names = new Set([fileName(emoji, emoji.includes('‍')), fileName(emoji, false)]);
  return [...names].map((name) => `${__TWEMOJI_PATH__}${name}.svg`);
}

export type EmojiPart = string | { emoji: string };

/** `text` cut into runs of plain text and single emojis, in order. */
export function splitEmoji(text: string): EmojiPart[] {
  if (!graphemeSegmenter || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(text)) return [text];
  const parts: EmojiPart[] = [];
  let run = '';
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (isEmojiGrapheme(segment)) {
      if (run) { parts.push(run); run = ''; }
      parts.push({ emoji: segment });
    } else {
      run += segment;
    }
  }
  if (run) parts.push(run);
  return parts;
}

// which URL of an emoji loaded, or that none did; shared by every place it shows
type Resolved = { url: string } | 'missing';
const resolved = new Map<string, Resolved>();
const pending = new Map<string, Promise<Resolved>>();

function probe(url: string): Promise<boolean> {
  return new Promise((done) => {
    const image = new Image();
    image.onload = () => done(true);
    image.onerror = () => done(false);
    image.src = url;
  });
}

export function resolvedTwemoji(emoji: string): Resolved | undefined {
  return resolved.get(emoji);
}

/** Finds the picture that exists (the browser caches it for the CSS that draws it). */
export function resolveTwemoji(emoji: string): Promise<Resolved> {
  const known = resolved.get(emoji);
  if (known) return Promise.resolve(known);
  let request = pending.get(emoji);
  if (!request) {
    request = (async () => {
      for (const url of twemojiUrls(emoji)) {
        if (await probe(url)) return { url };
      }
      return 'missing' as const;
    })().then((result) => {
      resolved.set(emoji, result);
      pending.delete(emoji);
      return result;
    });
    pending.set(emoji, request);
  }
  return request;
}
