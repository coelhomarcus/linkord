import { useEffect, type RefObject } from 'react';

const HIGHLIGHT = 'search-match';
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

// every result registers its ranges into the one named highlight
const live = new Map<object, Range[]>();

function repaint(): void {
  const registry = (globalThis.CSS as { highlights?: Map<string, unknown> } | undefined)?.highlights;
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  registry.set(HIGHLIGHT, new HighlightCtor(...[...live.values()].flat()));
}

/** Marks where the searched words start inside a result, accents and case
 * aside, with the CSS Custom Highlight API: the rendered message stays as the
 * chat draws it. Where the browser lacks the API, nothing is marked. */
export function useTextHighlight(ref: RefObject<HTMLElement | null>, words: string[]): void {
  const key = words.join('\u0000');
  useEffect(() => {
    const root = ref.current;
    const terms = key ? key.split('\u0000').map(fold).filter((w) => w.length > 1) : [];
    if (!root || !terms.length) return;
    const owner = {};
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      const folded = fold(text);
      // folding keeps one code unit per letter for the Latin text people search, so offsets line up
      if (folded.length !== text.length) continue;
      for (const term of terms) {
        for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
          if (at > 0 && /[\p{L}\p{N}]/u.test(folded[at - 1]!)) continue;
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + term.length);
          ranges.push(range);
        }
      }
    }
    live.set(owner, ranges);
    repaint();
    return () => {
      live.delete(owner);
      repaint();
    };
  }, [ref, key]);
}

/** The words of a full-text query worth marking: not operators or quotes. */
export function highlightWords(text: string): string[] {
  return text.replace(/["()]/g, ' ').split(/\s+/).filter((w) => w && !w.startsWith('-') && w.toLowerCase() !== 'or');
}
