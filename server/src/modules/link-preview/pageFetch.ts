import { requestSafe } from '../../net/safeRequest.js';
import { decodeBody } from './htmlMeta.js';

// Everything a link preview fetches: the page, the type of a file it names,
// an oEmbed answer (its picture goes through the media proxy, linkPreview.ts). The URL is chosen by whoever
// sent the message, a classic SSRF risk, so every request goes through
// net/safeRequest.ts (IP checked at connection time, every redirect hop
// checked again), and every body read is capped in bytes and time.

export type Lookup = Parameters<typeof requestSafe>[4];

const PROBE_TIMEOUT_MS = 3000;
// safety net for a malformed page with no `</head>`: the real cutoff is
// semantic; YouTube's head alone can be ~700KB before the first OG tag.
const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const HEAD_CLOSE_RE = /<\/head/i;

/** The content type a URL really answers with, read from the headers alone
 * (the body is never downloaded), or null when it cannot be reached. A page
 * names a "video" that is often an HTML player; only this tells them apart. */
export async function probeMediaType(mediaUrl: string, lookup?: Lookup): Promise<string | null> {
  try {
    return await requestSafe<string | null>(mediaUrl, MAX_REDIRECTS, 'video/*,audio/*;q=0.9,*/*;q=0.1', (res, _finalUrl, resolve) => {
      res.destroy();
      resolve(String(res.headers['content-type'] || '').split(';')[0]!.trim().toLowerCase() || null);
    }, lookup, PROBE_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export type FetchedPage =
  | { kind: 'html'; html: string; finalUrl: string }
  /** the URL is a picture itself, not a page */
  | { kind: 'image'; finalUrl: string }
  /** the URL is a video or audio file itself */
  | { kind: 'video' | 'audio'; finalUrl: string }
  /** anything else: nothing to read */
  | { kind: 'other'; finalUrl: string };

export function fetchPage(targetUrl: string, lookup?: Lookup): Promise<FetchedPage> {
  return requestSafe<FetchedPage>(targetUrl, MAX_REDIRECTS, 'text/html,image/*;q=0.8,*/*;q=0.5', (res, finalUrl, resolve, reject) => {
    const contentType = String(res.headers['content-type'] || '');

    // a file is never downloaded here: it can be arbitrarily large, and a
    // picture is read by the media proxy, which caps it
    if (/^image\//i.test(contentType)) {
      res.destroy();
      return resolve({ kind: 'image', finalUrl });
    }
    if (/^(video|audio)\//i.test(contentType)) {
      res.destroy();
      return resolve({ kind: contentType.toLowerCase().startsWith('video/') ? 'video' : 'audio', finalUrl });
    }
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      res.destroy();
      return resolve({ kind: 'other', finalUrl });
    }

    // Bytes, not text: the charset is only known once the page's first bytes
    // have been read (see decodeBody).
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let tail = '';
    const done = () => {
      settled = true;
      resolve({ kind: 'html', html: decodeBody(Buffer.concat(chunks, bytes), contentType), finalUrl });
    };
    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      chunks.push(chunk);
      bytes += chunk.length;
      // stop once </head> closes (the meta tags live there, never in <body>),
      // or at the byte cap as a safety net for a page with no normal head.
      // latin-1 reads the ASCII markup the same in any ASCII-based charset.
      const window = tail + chunk.toString('latin1');
      tail = window.slice(-6);
      if (HEAD_CLOSE_RE.test(window) || bytes >= MAX_BODY_BYTES) {
        res.destroy();
        done();
      }
    });
    res.on('end', () => { if (!settled) done(); });
    res.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  }, lookup);
}

const MAX_JSON_BYTES = 64 * 1024;

/** A small JSON document (an oEmbed answer). Rejects when it is larger than
 * the cap or not JSON. */
export function fetchJson(targetUrl: string, lookup?: Lookup): Promise<unknown> {
  return requestSafe<unknown>(targetUrl, MAX_REDIRECTS, 'application/json', (res, _finalUrl, resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    res.on('data', (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_JSON_BYTES) { settled = true; res.destroy(); return reject(new Error('response too large')); }
      chunks.push(chunk);
    });
    res.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))); } catch (err) { reject(err as Error); }
    });
    res.on('error', (err) => { if (!settled) { settled = true; reject(err); } });
  }, lookup, PROBE_TIMEOUT_MS * 2);
}
