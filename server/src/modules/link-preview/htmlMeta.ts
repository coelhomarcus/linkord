import { TextDecoder } from 'node:util';
import { Parser } from 'htmlparser2';

// Reads what a link preview needs from a page with a real HTML parser:
// attribute order, quoting and entities are the parser's problem, not a
// regex's. Only the start of the page is ever parsed (see pageFetch.ts).

/** Elements whose content never holds the page's own metadata: a `<meta>`
 * written inside a script string or a `<noscript>` fallback is not the
 * page's, and an SVG's `<title>` is not the page title. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'svg']);

export interface PageMeta {
  /** Every `<meta>` value under its lowercased key (`property`, `name` or
   * `itemprop`), in document order. */
  metas: Map<string, string[]>;
  title: string | null;
  favicon: string | null;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Reads the page's `<head>` only. The fetch stops at `</head>` but keeps
 * whatever else arrived in the same chunk; reading on into it would make the
 * result depend on how the response happened to be split. */
export function parsePageMeta(html: string): PageMeta {
  const metas = new Map<string, string[]>();
  let title: string | null = null;
  let titleText: string | null = null;
  let favicon: string | null = null;
  let skipDepth = 0;
  let headDone = false;

  const parser = new Parser({
    onopentag(name, attrs) {
      if (headDone) return;
      if (SKIPPED.has(name)) { skipDepth++; return; }
      if (skipDepth) return;
      if (name === 'body') { headDone = true; return; }
      if (name === 'meta') {
        const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.trim().toLowerCase();
        const value = attrs.content ?? attrs.value;
        if (!key || value === undefined) return;
        const list = metas.get(key);
        if (list) list.push(value); else metas.set(key, [value]);
      } else if (name === 'title' && title === null && titleText === null) {
        titleText = '';
      } else if (name === 'link' && favicon === null && attrs.href) {
        const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
        if (rel.includes('icon') || rel.includes('apple-touch-icon')) favicon = attrs.href.trim();
      }
    },
    ontext(text) {
      if (!headDone && !skipDepth && titleText !== null) titleText += text;
    },
    onclosetag(name) {
      if (headDone) return;
      if (SKIPPED.has(name)) { skipDepth = Math.max(0, skipDepth - 1); return; }
      if (name === 'title' && titleText !== null) { title = collapse(titleText) || null; titleText = null; }
      if (name === 'head') headDone = true;
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();
  return { metas, title, favicon };
}

/** The first non-empty value among `keys`, in that order of preference. */
export function firstMeta(metas: Map<string, string[]>, ...keys: string[]): string | null {
  for (const key of keys) {
    for (const value of metas.get(key) ?? []) {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/** Every non-empty value of `keys`: all of the first key's, then the next's. */
export function allMeta(metas: Map<string, string[]>, ...keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) for (const value of metas.get(key) ?? []) if (value.trim()) out.push(value.trim());
  return out;
}

/** The plain text of the first `<p>` in a fragment, as an oEmbed provider's
 * blockquote carries a post's text. Only text comes out: the markup itself is
 * never kept or rendered. */
export function firstParagraphText(html: string): string | null {
  let depth = 0;
  let text = '';
  let done = false;
  const parser = new Parser({
    onopentag(name) {
      if (done) return;
      if (name === 'p') depth++;
      else if (name === 'br' && depth) text += '\n';
    },
    ontext(chunk) { if (!done && depth) text += chunk; },
    onclosetag(name) {
      if (done || name !== 'p' || !depth) return;
      depth--;
      if (!depth) done = true;
    },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(html);
  parser.end();
  const lines = text.split('\n').map((line) => line.replace(/[ \t\f\r]+/g, ' ').trim());
  return lines.join('\n').trim() || null;
}

/** A field that should be text but may carry markup or entities (some
 * providers put HTML in an oEmbed `description`), as plain text. */
export function plainText(fragment: string): string | null {
  let text = '';
  const parser = new Parser({
    onopentag(name) { if (name === 'br' || name === 'p') text += '\n'; },
    ontext(chunk) { text += chunk; },
  }, { decodeEntities: true, lowerCaseTags: true });
  parser.write(fragment);
  parser.end();
  const lines = text.replace(/\u00a0/g, ' ').split('\n').map((line) => line.replace(/[ \t\f\r]+/g, ' ').trim());
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() || null;
}

/** The `src` of the first `<iframe>` in a fragment. The caller decides
 * whether its host may be trusted (isAllowlistedPlayer in preview.ts). */
export function firstIframeSrc(html: string): string | null {
  let src: string | null = null;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (src === null && name === 'iframe' && attrs.src) src = attrs.src.trim();
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(html);
  parser.end();
  return src;
}

// ---- charset ----

/** How far into the page a `<meta charset>` is looked for, as browsers do. */
const CHARSET_SNIFF_BYTES = 1024;

export function charsetFromContentType(contentType: string | null | undefined): string | null {
  const m = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType ?? '');
  return m ? m[1]!.toLowerCase() : null;
}

function charsetFromBom(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  return null;
}

/** The charset a page declares in its first bytes: `<meta charset>` or the
 * `http-equiv="content-type"` form. */
export function sniffMetaCharset(bytes: Uint8Array): string | null {
  // latin-1 maps every byte to one character, so ASCII markup reads the same
  // whatever the real encoding is
  const head = Buffer.from(bytes.subarray(0, CHARSET_SNIFF_BYTES)).toString('latin1');
  let found: string | null = null;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (found || name !== 'meta') return;
      if (attrs.charset) found = attrs.charset.trim().toLowerCase();
      else if ((attrs['http-equiv'] ?? '').toLowerCase() === 'content-type') found = charsetFromContentType(attrs.content);
    },
  }, { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true });
  parser.write(head);
  parser.end();
  return found;
}

function decoderFor(label: string | null): TextDecoder | null {
  if (!label) return null;
  try { return new TextDecoder(label); } catch { return null; }
}

/** A page's bytes as text, in the charset it is really written in: a byte
 * order mark first, then the `Content-Type` header, then the page's own
 * declaration, then UTF-8. An unknown label is skipped, never fatal. */
export function decodeBody(bytes: Uint8Array, contentType: string | null | undefined): string {
  const decoder = decoderFor(charsetFromBom(bytes))
    ?? decoderFor(charsetFromContentType(contentType))
    ?? decoderFor(sniffMetaCharset(bytes))
    ?? new TextDecoder('utf-8');
  return decoder.decode(bytes);
}
