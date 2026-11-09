import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { isSecureRequest } from './cookies.js';

/** Where browsers post violations (see modules/logs/cspReports.ts). */
export const CSP_REPORT_PATH = '/api/csp-reports';
const REPORT_GROUP = 'csp';

// Players embedded as plain iframes (features/media/GenericEmbed.tsx). No
// third-party script runs in our page for them, so they only need frame-src.
const EMBED_FRAMES = ['https://www.youtube.com', 'https://player.twitch.tv', 'https://clips.twitch.tv'];
// the GIF picker calls KLIPY from the browser, as its terms require
const KLIPY_API = 'https://api.klipy.com';
// LiveKit Cloud first asks the project URL for its regions and may then
// connect to any regional host of the same domain
const LIVEKIT_CLOUD_DOMAINS = ['livekit.cloud', 'livekit.run'];

// a JSON response never renders anything, so it may load nothing at all
const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

export interface PolicyInput {
  appUrl: string;
  livekitUrl: string;
  klipyEnabled: boolean;
  /** 'sha256-…' sources for the inline scripts of the built HTML pages */
  scriptHashes: string[];
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
  // GIFs (KLIPY's terms), media links pasted in chat, webhook embed images and
  // MEDIA_PROXY=0's redirects load from any site; the rest of the third-party
  // pictures come through modules/media-proxy. A page served over plain http
  // (local runs, the e2e stack) also shows http ones
  const insecurePage = originOf(input.appUrl)?.protocol === 'http:';
  const remoteMedia = insecurePage ? ['https:', 'http:'] : ['https:'];
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...input.scriptHashes.map((hash) => `'${hash}'`)]],
    // inline styles stay allowed: React and the UI libraries set them, the
    // theme bootstrap and the crop dialog inject <style> elements, and a
    // style cannot run script
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...remoteMedia]],
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

/** 'sha256-…' of every inline <script> in an HTML document, hashed exactly as
 * the browser does (the text between the tags, untouched). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const [, attributes = '', body = ''] of html.matchAll(INLINE_SCRIPT_RE)) {
    if (/\ssrc\s*=/i.test(attributes) || body.length === 0) continue;
    hashes.push(`sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}`);
  }
  return hashes;
}

/** Hashes for the HTML pages of the frontend build, read once at boot: the
 * build is fixed for the life of the process. Missing files (tests, a server
 * started before the web build) simply contribute none. */
export function readBuildScriptHashes(publicDir: string): string[] {
  const hashes = new Set<string>();
  for (const page of ['index.html', 'offline.html']) {
    let html: string;
    try { html = fs.readFileSync(path.join(publicDir, page), 'utf8'); } catch { continue; }
    for (const hash of inlineScriptHashes(html)) hashes.add(hash);
  }
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
    scriptHashes: readBuildScriptHashes(publicDir),
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
