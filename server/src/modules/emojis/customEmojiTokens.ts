// A server emoji travels inside message text as `<:name:id>` (`<a:name:id>`
// when animated), Discord's format, and as the reaction `custom:<id>`. Anyone
// may read one; only members of the emoji's server may send one (Discord's
// Nitro rule, given to everyone): a token the author can't use is stored as
// the plain `:name:` it stands for. The web mirror is in
// web/src/features/chat/messageMarkup.ts and features/emoji/customEmojiText.ts.
// Pure on purpose: push previews and tests use it without a database.

const TOKEN_RE = /<(a?):([a-z0-9_]{2,32}):([0-9a-f]{32})>/g;
// code is quoted text: a token in it stays exactly as typed
const CODE_RE = /```[\s\S]*?```|`[^`\n]+`/g;
const REACTION_RE = /^custom:([0-9a-f]{32})$/;

/** Applies `fn` to the parts of `text` outside code spans and blocks. */
function outsideCode(text: string, fn: (part: string) => string): string {
  let out = '';
  let last = 0;
  for (const match of text.matchAll(CODE_RE)) {
    out += fn(text.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + fn(text.slice(last));
}

export function customEmojiIds(text: string): string[] {
  const ids: string[] = [];
  outsideCode(text, (part) => {
    for (const match of part.matchAll(TOKEN_RE)) ids.push(match[3]!);
    return part;
  });
  return [...new Set(ids)];
}

/** Keeps the tokens of `usable` emojis (with their current name and kind) and
 * turns every other into `:name:`. */
export function rewriteCustomEmojis(text: string, usable: Map<string, { id: string; name: string; animated: boolean }>): string {
  return outsideCode(text, (part) => part.replace(TOKEN_RE, (_full, _a: string, name: string, id: string) => {
    const emoji = usable.get(id);
    return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : `:${name}:`;
  }));
}

/** Tokens read as their `:name:`, for places that show plain text (push). */
export function customEmojisAsText(text: string): string {
  return outsideCode(text, (part) => part.replace(TOKEN_RE, (_full, _a: string, name: string) => `:${name}:`));
}

/** The emoji id of a `custom:<id>` reaction, or null for any other value. */
export function customReactionId(value: string): string | null {
  return REACTION_RE.exec(value)?.[1] ?? null;
}
