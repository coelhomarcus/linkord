// Which links of a message get a preview card — mirrors the link handling of
// web/src/features/chat/messageMarkup.ts (same regexes, same order, same
// trimming, same cap), the way embeds.ts mirrors chatEmbeds.ts: the server
// stores a preview for exactly the cards the client draws. Change one side,
// change the other. Only what decides the links and the @mentions is kept:
// emphasis matters here just because it can wrap either.

type Inline =
  | { type: 'text' }
  | { type: 'code' }
  | { type: 'link'; url: string; suppressed: boolean }
  | { type: 'mention'; name: string }
  | { type: 'emphasis'; children: Inline[] };

type Block = { type: 'paragraph' | 'quote'; children: Inline[] } | { type: 'code' } | { type: 'list'; items: Inline[][] };

const INLINE_RE = new RegExp([
  '`([^`\\n]+)`',
  '<(https?:\\/\\/[^\\s<>]+)>',
  '(https?:\\/\\/[^\\s<>"\']+)',
  '(?<![\\w@.])@([A-Za-z0-9_.-]{1,20})',
  '\\*\\*(.+?)\\*\\*',
  '~~(.+?)~~',
  '\\*([^*\\s](?:[^*]*?[^*\\s])?)\\*',
  '(?<![A-Za-z0-9_])_([^_\\s](?:[^_]*?[^_\\s])?)_(?![A-Za-z0-9_])',
].join('|'), 'gs');

const TRAILING_PUNCTUATION = /[.,;:!?'"]$/;

function trimUrl(url: string): string {
  let out = url;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(out)) { out = out.slice(0, -1); continue; }
    if (out.endsWith(')') && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) { out = out.slice(0, -1); continue; }
    return out;
  }
}

function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  const re = new RegExp(INLINE_RE);
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const [, code, suppressed, url, mention, bold, strike, starItalic, underItalic] = match;
    if (code !== undefined) nodes.push({ type: 'code' });
    else if (suppressed !== undefined) nodes.push({ type: 'link', url: suppressed, suppressed: true });
    else if (url !== undefined) {
      const trimmed = trimUrl(url);
      nodes.push({ type: 'link', url: trimmed, suppressed: false });
      re.lastIndex = match.index + trimmed.length;
    } else if (mention !== undefined) {
      const name = mention.replace(/\.+$/, '');
      nodes.push({ type: 'mention', name });
      re.lastIndex = match.index + 1 + name.length;
    } else nodes.push({ type: 'emphasis', children: parseInline((bold ?? strike ?? starItalic ?? underItalic)!) });
  }
  return nodes;
}

const FENCE_RE = /^```([A-Za-z0-9_+#-]*)\s*$/;
const QUOTE_RE = /^> ?(.*)$/;
const BULLET_RE = /^\s*[-*] +(.*)$/;
const ORDERED_RE = /^\s*\d{1,3}[.)] +(.*)$/;

function parseMessage(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const joined = paragraph.join('\n');
    if (joined.trim()) blocks.push({ type: 'paragraph', children: parseInline(joined) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE_RE.test(line.trim())) {
      const end = lines.findIndex((l, j) => j > i && l.trim() === '```');
      if (end !== -1) { flush(); blocks.push({ type: 'code' }); i = end; continue; }
    }
    if (/^```([^`]+)```$/.test(line.trim())) { flush(); blocks.push({ type: 'code' }); continue; }
    if (QUOTE_RE.test(line) && line.startsWith('>')) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) { quoted.push(QUOTE_RE.exec(lines[i]!)![1]!); i++; }
      i--;
      blocks.push({ type: 'quote', children: parseInline(quoted.join('\n')) });
      continue;
    }
    const listRe = BULLET_RE.test(line) ? BULLET_RE : ORDERED_RE.test(line) ? ORDERED_RE : null;
    if (listRe) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && listRe.test(lines[i]!)) { items.push(parseInline(listRe.exec(lines[i]!)![1]!)); i++; }
      i--;
      blocks.push({ type: 'list', items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function collectInline(nodes: Inline[], out: string[]) {
  for (const node of nodes) {
    if (node.type === 'link' && !node.suppressed) out.push(node.url);
    else if (node.type === 'emphasis') collectInline(node.children, out);
  }
}

export const MAX_PREVIEWS = 3;

/** Links worth a preview: outside code, not wrapped in <…>, each address
 * once, at most three. */
export function previewableLinks(text: string): string[] {
  const urls: string[] = [];
  for (const block of parseMessage(text)) {
    if (block.type === 'paragraph' || block.type === 'quote') collectInline(block.children, urls);
    else if (block.type === 'list') block.items.forEach((item) => collectInline(item, urls));
  }
  return [...new Set(urls)].slice(0, MAX_PREVIEWS);
}

function collectMentions(nodes: Inline[], out: string[]) {
  for (const node of nodes) {
    if (node.type === 'mention') out.push(node.name.toLowerCase());
    else if (node.type === 'emphasis') collectMentions(node.children, out);
  }
}

/** The usernames a message @mentions, lowercased and each once — the same
 * ones the client draws as mention chips: never inside code, never the tail
 * of an e-mail address. */
export function mentionedUsernames(text: string): string[] {
  const names: string[] = [];
  for (const block of parseMessage(text)) {
    if (block.type === 'paragraph' || block.type === 'quote') collectMentions(block.children, names);
    else if (block.type === 'list') block.items.forEach((item) => collectMentions(item, names));
  }
  return [...new Set(names)];
}
