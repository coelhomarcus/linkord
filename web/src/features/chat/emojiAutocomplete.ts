// The composer's ":shortcode" handling, as pure text functions. A shortcode
// only starts a word (start of text, after a space or an opening bracket), so
// "10:30" or "http://" never open the list.

const MIN_QUERY = 2;
const NAME = '[A-Za-z0-9_+~-]';
const QUERY_RE = new RegExp(`(?:^|[\\s(\\[{])(:(${NAME}{${MIN_QUERY},32}))$`);
const CLOSED_RE = new RegExp(`(?:^|[\\s(\\[{])(:(${NAME}{2,32}):)$`);

export interface EmojiQuery {
  /** index of the ":" */
  start: number;
  query: string;
}

/** The ":query" the caret sits at the end of, if any. */
export function getEmojiQuery(text: string, cursor: number): EmojiQuery | null {
  const match = QUERY_RE.exec(text.slice(0, cursor));
  if (!match) return null;
  return { start: match.index + match[0].length - match[1]!.length, query: match[2]! };
}

export interface TextEdit {
  text: string;
  caret: number;
}

/** Puts `insertion` where ":query" was, followed by a space unless one is
 * already there. */
export function insertAtQuery(text: string, query: EmojiQuery, insertion: string): TextEdit {
  const before = text.slice(0, query.start);
  const after = text.slice(query.start + 1 + query.query.length);
  const spacer = /^\s/.test(after) ? '' : ' ';
  return { text: before + insertion + spacer + after, caret: before.length + insertion.length + spacer.length };
}

/** A ":name:" just closed at the caret becomes what `resolve` gives for it;
 * null when there is nothing to convert. */
export function completeClosedShortcode(text: string, cursor: number, resolve: (name: string) => string | null): TextEdit | null {
  const match = CLOSED_RE.exec(text.slice(0, cursor));
  if (!match) return null;
  const replacement = resolve(match[2]!.toLowerCase());
  if (!replacement) return null;
  const start = match.index + match[0].length - match[1]!.length;
  return { text: text.slice(0, start) + replacement + text.slice(cursor), caret: start + replacement.length };
}

export const emojiOptionId = (listId: string, index: number) => `${listId}-option-${index}`;
