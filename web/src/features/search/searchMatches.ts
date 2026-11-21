const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export interface TextPart {
  text: string;
  match: boolean;
}

/** The words of a full-text query worth marking: not operators or quotes. */
export function highlightWords(text: string): string[] {
  return text.replace(/["()]/g, ' ').split(/\s+/).filter((w) => w && !w.startsWith('-') && w.toLowerCase() !== 'or');
}

/** The searched words as they are compared: accents and case aside, and
 * nothing a single letter long (it would mark half the message). */
export function matchTerms(words: readonly string[]): string[] {
  return words.map(fold).filter((w) => w.length > 1);
}

/** `text` cut where the terms start a word, accents and case aside, so each
 * match can be drawn as a mark. Marks are real elements rather than the CSS
 * Custom Highlight API: Chromium rebuilds every custom highlight on any style
 * change in the document, so with results open each hover anywhere repainted
 * all of their text, which flickered on some GPUs. */
export function splitMatches(text: string, terms: readonly string[]): TextPart[] {
  if (!terms.length || !text) return [{ text, match: false }];
  const folded = fold(text);
  // folding keeps one code unit per letter for the Latin text people search, so offsets line up
  if (folded.length !== text.length) return [{ text, match: false }];
  const spans: [number, number][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      if (at > 0 && /[\p{L}\p{N}]/u.test(folded[at - 1]!)) continue;
      spans.push([at, at + term.length]);
    }
  }
  if (!spans.length) return [{ text, match: false }];
  spans.sort((a, b) => a[0] - b[0]);
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const [start, end] of spans) {
    if (end <= cursor) continue;
    const from = Math.max(start, cursor);
    if (from > cursor) parts.push({ text: text.slice(cursor, from), match: false });
    const last = parts.at(-1);
    // overlapping terms ("men" and "mensagem") make one mark, not two side by side
    if (last?.match && from === cursor) last.text += text.slice(from, end);
    else parts.push({ text: text.slice(from, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts;
}
