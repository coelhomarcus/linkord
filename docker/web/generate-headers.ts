import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildContentSecurityPolicy, readBuildScriptHashes, readBuildStyleHashes, reportingEndpoints,
} from '../../server/src/http/pageSecurityPolicy.js';

function publicUrl(name: string, protocols: string[], raw: string): URL {
  const url = URL.parse(raw);
  if (!url || !protocols.includes(url.protocol) || url.username || url.password
    || !/^[a-z0-9.:[\]\-]+$/i.test(url.hostname)) {
    throw new Error(`${name} must be a valid public URL.`);
  }
  return url;
}

function flag(name: string, fallback: '0' | '1'): boolean {
  const value = process.env[name] ?? fallback;
  if (value !== '0' && value !== '1') throw new Error(`${name} must be 0 or 1.`);
  return value === '1';
}

const app = publicUrl('APP_URL', ['http:', 'https:'], process.env.APP_URL ?? '');
if (app.pathname !== '/' || app.search || app.hash) throw new Error('APP_URL must be an origin.');
const appUrl = app.origin;
const livekit = process.env.LIVEKIT_URL?.trim();
const livekitUrl = livekit ? publicUrl('LIVEKIT_URL', ['http:', 'https:', 'ws:', 'wss:'], livekit).origin : '';
const dist = path.resolve(import.meta.dirname, '../../web/dist');
for (const file of ['index.html', 'offline.html', 'sw.js', 'csp-style-sources.json']) readFileSync(path.join(dist, file));
const scriptHashes = readBuildScriptHashes(dist);
const styleHashes = readBuildStyleHashes(dist);
if (!scriptHashes.length || !styleHashes.length) throw new Error('The web build is missing its inline CSP sources.');
const policy = buildContentSecurityPolicy({
  appUrl, livekitUrl, scriptHashes, styleHashes,
  klipyEnabled: flag('KLIPY_ENABLED', '0'),
  mediaProxyEnabled: flag('MEDIA_PROXY', '1'),
});
const header = flag('CSP_REPORT_ONLY', '0') ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
const reports = reportingEndpoints(appUrl);
const headers = [[header, policy]];
if (reports) headers.push(['Reporting-Endpoints', reports], ['Strict-Transport-Security', 'max-age=31536000']);
for (const [name, value] of headers) console.log(`add_header ${name} ${JSON.stringify(value)} always;`);
