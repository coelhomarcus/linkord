import type { CustomEmoji } from './myEmojis';

// Server emojis inside message text, Discord's way: `<:name:id>`, or
// `<a:name:id>` when animated. The composer shows and edits `:name:`; the
// token is what goes out. Mirrors server/src/modules/emojis/customEmojiTokens.ts.

export const CUSTOM_EMOJI_TOKEN = '<(a?):([a-z0-9_]{2,32}):([0-9a-f]{32})>';
const TOKEN_RE = new RegExp(CUSTOM_EMOJI_TOKEN, 'g');
// `:name:` or `:name~2:` (the second emoji of that name), not glued to a word
const NAME_RE = /(?<![\w:<]):([a-z0-9_]{2,32})(?:~(\d{1,2}))?:(?![\w])/g;
// code is quoted text: nothing in it is converted either way
const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const REACTION_PREFIX = 'custom:';

function outsideCode(text: string, fn: (part: string) => string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(CODE_RE)) {
    out += fn(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + fn(text.slice(last));
}

export const customReactionKey = (emojiId: string) => `${REACTION_PREFIX}${emojiId}`;

/** The emoji id of a `custom:<id>` reaction (or frequent-use key). */
export function customReactionId(key: string): string | null {
  return key.startsWith(REACTION_PREFIX) && /^[0-9a-f]{32}$/.test(key.slice(REACTION_PREFIX.length)) ? key.slice(REACTION_PREFIX.length) : null;
}

function customEmojiToken(emoji: Pick<CustomEmoji, 'id' | 'name' | 'animated'>): string {
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

/** Tokens read as `:name:`, for one-line previews and for editing. */
export function customEmojisAsText(text: string): string {
  return outsideCode(text, (part) => part.replace(TOKEN_RE, (_full, _a: string, name: string) => `:${name}:`));
}

/** The emojis named in the tokens of `text`, by name: what an edit should
 * keep pointing at even when another emoji has the same name. */
export function tokensByName(text: string): Map<string, Pick<CustomEmoji, 'id' | 'name' | 'animated'>> {
  const out = new Map<string, Pick<CustomEmoji, 'id' | 'name' | 'animated'>>();
  for (const match of text.matchAll(TOKEN_RE)) {
    if (!out.has(match[2]!)) out.set(match[2]!, { id: match[3]!, name: match[2]!, animated: match[1] === 'a' });
  }
  return out;
}

/** The emojis a `:name:` can mean, in the order `:name:`, `:name~2:`… pick
 * them: the conversation's own server first, then the rail's order. */
export function emojisByName(groups: readonly { serverId: string; emojis: readonly CustomEmoji[] }[], preferServerId?: string | null): Map<string, CustomEmoji[]> {
  const ordered = preferServerId ? [...groups].sort((a, b) => Number(b.serverId === preferServerId) - Number(a.serverId === preferServerId)) : groups;
  const out = new Map<string, CustomEmoji[]>();
  for (const group of ordered) {
    for (const emoji of group.emojis) {
      const list = out.get(emoji.name);
      if (list) list.push(emoji); else out.set(emoji.name, [emoji]);
    }
  }
  return out;
}

/** `:name:` (or `:name~2:`) → its token, when the name is one of the
 * account's server emojis (or of `keep`, the tokens a message being edited
 * already had). Anything else stays as typed. */
export function encodeCustomEmojis(
  text: string,
  byName: Map<string, CustomEmoji[]>,
  keep?: Map<string, Pick<CustomEmoji, 'id' | 'name' | 'animated'>>,
): string {
  if (!text.includes(':')) return text;
  return outsideCode(text, (part) => part.replace(NAME_RE, (full, name: string, nth: string | undefined) => {
    if (!nth && keep?.has(name)) return customEmojiToken(keep.get(name)!);
    const emoji = byName.get(name)?.[nth ? Number(nth) - 1 : 0];
    return emoji ? customEmojiToken(emoji) : full;
  }));
}
