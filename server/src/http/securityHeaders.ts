import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { PLAYER_HOSTS } from '../modules/link-preview/playerHosts.js';
import { isSecureRequest } from './cookies.js';

/** Where browsers post violations (see modules/logs/cspReports.ts). */
export const CSP_REPORT_PATH = '/api/csp-reports';
const REPORT_GROUP = 'csp';

// Players embedded as plain iframes (features/media/GenericEmbed.tsx): the
// hosts on the link-preview player allowlist, each with its subdomains (Vimeo
// plays from player.vimeo.com, SoundCloud from w.soundcloud.com). No
// third-party script runs in our page for them, so they only need frame-src.
const EMBED_FRAMES = PLAYER_HOSTS.flatMap((domain) => [`https://${domain}`, `https://*.${domain}`]);
// the GIF picker calls KLIPY from the browser, as its terms require
const KLIPY_API = 'https://api.klipy.com';
// ...and loads its GIFs straight from static.klipy.com and its numbered
// mirrors (no copies, no proxy). Allowed even with the picker off: GIF
// messages already sent still show.
const KLIPY_MEDIA = 'https://*.klipy.com';
// LiveKit Cloud first asks the project URL for its regions and may then
// connect to any regional host of the same domain
const LIVEKIT_CLOUD_DOMAINS = ['livekit.cloud', 'livekit.run'];

// a JSON response never renders anything, so it may load nothing at all
const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

export interface PolicyInput {
  appUrl: string;
  livekitUrl: string;
  klipyEnabled: boolean;
  /** MEDIA_PROXY=0 answers the proxy's addresses with a redirect to the
   * picture's own host, so pictures must then load from anywhere */
  mediaProxyEnabled: boolean;
  /** 'sha256-…' sources for the inline scripts of the built HTML pages */
  scriptHashes: string[];
  /** 'sha256-…' sources for the inline stylesheets the build actually injects */
  styleHashes: string[];
}

const originOf = (raw: string): URL | null => {
  try { return new URL(raw); } catch { return null; }
};

/** The page's own websocket origin, for browsers whose 'self' does not
 * cover ws:/wss: yet (Safari before 15.4). */
function socketSources(appUrl: string): string[] {
  const url = originOf(appUrl);
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return [];
  return [`${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`];
}

/** LiveKit is reached over both a websocket (signalling) and HTTP (the
 * connection check and, on Cloud, the region list). */
export function livekitSources(livekitUrl: string): string[] {
  const url = originOf(livekitUrl);
  if (!url) return [];
  const secure = url.protocol === 'wss:' || url.protocol === 'https:';
  const [ws, http] = secure ? ['wss', 'https'] : ['ws', 'http'];
  const cloud = LIVEKIT_CLOUD_DOMAINS.find((domain) => url.hostname.endsWith(`.${domain}`));
  const host = cloud ? `*.${cloud}` : url.host;
  return [`${ws}://${host}`, `${http}://${host}`];
}

/** Chrome only accepts a Reporting-Endpoints header from an https page, and a
 * policy naming `report-to` makes it ignore `report-uri`: over plain http
 * (local runs, the e2e stack) the policy keeps to `report-uri` alone. */
function usesReportingApi(appUrl: string): boolean {
  return originOf(appUrl)?.protocol === 'https:';
}

/** The Content-Security-Policy for every page and file the app serves. */
export function buildContentSecurityPolicy(input: PolicyInput): string {
  // Third-party pictures come through modules/media-proxy, so a picture
  // pasted in chat never tells its host who is reading. The exceptions are
  // KLIPY's GIFs and MEDIA_PROXY=0's redirects. Video and audio links play
  // from their own host, only once the reader asks to load them
  // (features/media/LinkPreview.tsx). A page served over plain http (local
  // runs, the e2e stack) also plays http ones
  const insecurePage = originOf(input.appUrl)?.protocol === 'http:';
  const remoteMedia = insecurePage ? ['https:', 'http:'] : ['https:'];
  const remoteImages = input.mediaProxyEnabled ? [KLIPY_MEDIA] : remoteMedia;
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...input.scriptHashes.map((hash) => `'${hash}'`)]],
    // style-src is only the fallback for a browser that ignores the two
    // directives below. Anything that can render the theme (oklch: Firefox 113,
    // Safari 15.4) already understands the split, so elements do not get
    // 'unsafe-inline' from here.
    ['style-src', ["'self'"]],
    // <style> and <link>: our stylesheets, plus the hash of each inline sheet
    // the build injects (offline page, the three theme backgrounds, the crop
    // dialog). An injected sheet whose text matches none of them is refused.
    ['style-src-elem', ["'self'", ...input.styleHashes.map((hash) => `'${hash}'`)]],
    // style attributes and CSSOM assignments. React, Motion and Base UI set
    // them while rendering; the text is not stable, so it cannot be hashed.
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...remoteImages]],
    ['media-src', ["'self'", 'data:', 'blob:', ...remoteMedia]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...socketSources(input.appUrl), ...livekitSources(input.livekitUrl), ...(input.klipyEnabled ? [KLIPY_API] : [])]],
    ['frame-src', EMBED_FRAMES],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    // report-uri is what Firefox and Safari use; Chrome prefers report-to when it can
    ['report-uri', [CSP_REPORT_PATH]],
  ];
  if (usesReportingApi(input.appUrl)) directives.push(['report-to', [REPORT_GROUP]]);
  return directives.map(([name, sources]) => `${name} ${[...new Set(sources)].join(' ')}`).join('; ');
}

const INLINE_SCRIPT_RE = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const INLINE_STYLE_RE = /<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi;
// The theme bootstrap in web/index.html. The color list is read from the built
// page; the concatenation around it has to stay this text or the hash misses.
const THEME_SHELLS_RE = /var shells = \{([^}]*)\}/;

/** Written by the web build (vite.config.ts). One entry per runtime `<style>`
 * whose text is not in the HTML, today the crop dialog's stylesheet. */
const STYLE_SOURCES_FILE = 'csp-style-sources.json';

function sha256Source(text: string): string {
  return `sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}`;
}

/** 'sha256-…' of every inline <script> in an HTML document, hashed exactly as
 * the browser does (the text between the tags, untouched). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attributes = '', body = ''] of html.matchAll(INLINE_SCRIPT_RE)) {
    if (/\ssrc\s*=/i.test(attributes) || body.length === 0) continue;
    hashes.push(sha256Source(body));
  }
  return hashes;
}

/** 'sha256-…' of every inline <style> in an HTML document, same rules as scripts. */
export function inlineStyleHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, , body = ''] of html.matchAll(INLINE_STYLE_RE)) {
    if (body.length === 0) continue;
    hashes.push(sha256Source(body));
  }
  return hashes;
}

/** One hash per color the theme bootstrap may write into its `<style>` element:
 * `html,body{background:#…}`. */
export function themeBootstrapStyleHashes(html: string): string[] {
  const body = THEME_SHELLS_RE.exec(html)?.[1];
  if (!body) return [];
  return [...body.matchAll(/['"](#[0-9a-fA-F]{3,8})['"]/g)].map((match) => sha256Source(`html,body{background:${match[1]}}`));
}

function readHtmlPages(publicDir: string): string[] {
  const pages: string[] = [];
  for (const page of ['index.html', 'offline.html']) {
    try { pages.push(fs.readFileSync(path.join(publicDir, page), 'utf8')); } catch { /* not built yet */ }
  }
  return pages;
}

/** Hashes for the HTML pages of the frontend build, read once at boot: the
 * build is fixed for the life of the process. Missing files (tests, a server
 * started before the web build) simply contribute none. */
export function readBuildScriptHashes(publicDir: string): string[] {
  const hashes = new Set<string>();
  for (const html of readHtmlPages(publicDir)) {
    for (const hash of inlineScriptHashes(html)) hashes.add(hash);
  }
  return [...hashes];
}

/** Inline `<style>` elements of the build: the pages themselves, the theme
 * bootstrap's backgrounds, and the runtime sheets listed in the build's
 * `csp-style-sources.json`. Missing files contribute none. */
export function readBuildStyleHashes(publicDir: string): string[] {
  const hashes = new Set<string>();
  for (const html of readHtmlPages(publicDir)) {
    for (const hash of inlineStyleHashes(html)) hashes.add(hash);
    for (const hash of themeBootstrapStyleHashes(html)) hashes.add(hash);
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(publicDir, STYLE_SOURCES_FILE), 'utf8'));
    const sources = parsed && typeof parsed === 'object' && 'sources' in parsed ? parsed.sources : null;
    if (Array.isArray(sources)) {
      for (const source of sources) if (typeof source === 'string' && source.length > 0) hashes.add(sha256Source(source));
    }
  } catch { /* no build manifest, or it is not JSON */ }
  return [...hashes];
}

/** Fastify `onRequest` hook that sends the security headers on every response,
 * errors and 404s included. */
export function securityHeaders(publicDir: string) {
  const header = config.CSP_REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const appPolicy = buildContentSecurityPolicy({
    appUrl: config.APP_URL,
    livekitUrl: config.LIVEKIT_URL,
    klipyEnabled: !!config.KLIPY_API_KEY,
    mediaProxyEnabled: config.MEDIA_PROXY_ENABLED,
    scriptHashes: readBuildScriptHashes(publicDir),
    styleHashes: readBuildStyleHashes(publicDir),
  });
  const reportingApi = usesReportingApi(config.APP_URL);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // the API is always enforced: it has nothing to break
    if (request.url.startsWith('/api/')) reply.header('Content-Security-Policy', API_POLICY);
    else {
      reply.header(header, appPolicy);
      if (reportingApi) reply.header('Reporting-Endpoints', `${REPORT_GROUP}="${CSP_REPORT_PATH}"`);
    }
    // frame-ancestors for browsers too old to read it from the policy
    reply.header('X-Frame-Options', 'DENY');
    // no includeSubDomains: other services may live under the same domain over plain http
    if (isSecureRequest(request.raw)) reply.header('Strict-Transport-Security', 'max-age=31536000');
  };
}
