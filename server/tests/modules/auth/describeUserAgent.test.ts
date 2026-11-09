import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { describeUserAgent } from '../../../src/modules/auth/describeUserAgent.js';

// The server names a browser in the login alert email the way the web session list does; this keeps the
// two copies of the parser from drifting apart.
const WEB_PARSER = path.resolve(import.meta.dirname, '../../../../web/src/features/settings/describeUserAgent.ts');

const AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) SomeEngine/1.0',
  'curl/8.5.0',
  'node',
  '',
];

describe('describeUserAgent', () => {
  it('names the browser and system', () => {
    assert.deepEqual(describeUserAgent(AGENTS[0]!), { browser: 'Chrome', os: 'macOS', mobile: false, automated: false });
    assert.deepEqual(describeUserAgent(AGENTS[3]!), { browser: 'Safari', os: 'iOS', mobile: true, automated: false });
    assert.deepEqual(describeUserAgent(AGENTS[9]!), { browser: null, os: null, mobile: false, automated: true });
  });

  it('matches the web copy on every agent', async () => {
    const web = await import(pathToFileURL(WEB_PARSER).href) as { describeUserAgent: typeof describeUserAgent };
    for (const agent of AGENTS) assert.deepEqual(describeUserAgent(agent), web.describeUserAgent(agent), agent);
  });
});
