import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  allowedTarget, igdbCoverProxyUrl, igdbCoverUpstream, MEDIA_PROXY_PATH, proxiedImageUrl, setMediaProxyKey, verifiedTarget, youtubeThumbnailUpstream,
} from '../../../src/modules/media-proxy/mediaProxyUrls.js';

const parts = (address: string) => {
  const { pathname, searchParams } = new URL(address, 'http://linkord.test');
  const [kind, signature] = pathname.slice(MEDIA_PROXY_PATH.length + 1).split('/');
  return { kind: kind!, signature: signature!, target: searchParams.get('u')! };
};

describe('signed addresses', () => {
  before(() => setMediaProxyKey(crypto.randomBytes(32)));
  after(() => setMediaProxyKey(null));

  it('keep a long URL out of the path, which Fastify caps at 100 characters a segment', () => {
    const address = proxiedImageUrl('preview', `https://opengraph.githubassets.com/${'f'.repeat(64)}/nodejs/node`)!;
    assert.ok(address.split('?')[0]!.split('/').every((segment) => segment.length <= 100));
  });

  it('stand for the URL they were made from, and nothing else', () => {
    const address = proxiedImageUrl('preview', 'https://example.com/og.png?a=1')!;
    assert.match(address, /^\/api\/media-proxy\/preview\/[A-Za-z0-9_-]{22}\?u=[A-Za-z0-9_-]+$/);
    const { kind, signature, target } = parts(address);
    assert.equal(verifiedTarget(kind, signature, target)?.href, 'https://example.com/og.png?a=1');
  });

  it('refuse a URL swapped under the signature, another kind, and another key', () => {
    const { signature, target } = parts(proxiedImageUrl('preview', 'https://example.com/og.png')!);
    const other = Buffer.from('https://evil.example/x.png').toString('base64url');
    assert.equal(verifiedTarget('preview', signature, other), null);
    assert.equal(verifiedTarget('preview', signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A'), target), null);
    assert.equal(verifiedTarget('mal', signature, target), null);
    assert.equal(verifiedTarget('preview', signature, undefined), null);
    assert.equal(verifiedTarget('preview', signature, [target]), null);
    assert.equal(verifiedTarget('constructor', signature, target), null);
    setMediaProxyKey(crypto.randomBytes(32));
    assert.equal(verifiedTarget('preview', signature, target), null);
  });

  it('keep each fixed-host kind on its host', () => {
    assert.ok(proxiedImageUrl('mal', 'https://cdn.myanimelist.net/images/anime/1/2.jpg'));
    assert.ok(proxiedImageUrl('github', 'https://avatars.githubusercontent.com/u/1?v=4'));
    // dropped, never handed to the browser as is
    assert.equal(proxiedImageUrl('mal', 'https://attacker.example/track.png'), null);
    assert.equal(proxiedImageUrl('github', 'http://avatars.githubusercontent.com/u/1'), null);
    assert.equal(proxiedImageUrl('github', 'https://avatars.githubusercontent.com:8443/u/1'), null);
    assert.equal(allowedTarget('mal', 'https://cdn.myanimelist.net.attacker.example/x.jpg'), null);
  });

  it('take any public http(s) picture for previews, but no credentials or other schemes', () => {
    assert.ok(proxiedImageUrl('preview', 'http://example.com/og.png'));
    assert.equal(proxiedImageUrl('preview', 'https://user:pass@example.com/og.png'), null);
    assert.equal(proxiedImageUrl('preview', 'data:image/png;base64,AAAA'), null);
    assert.equal(proxiedImageUrl('preview', 'file:///etc/passwd'), null);
    assert.equal(proxiedImageUrl('preview', `https://example.com/${'a'.repeat(3000)}`), null);
  });

  it('leave an empty picture empty and an already proxied one alone', () => {
    assert.equal(proxiedImageUrl('preview', null), null);
    const address = proxiedImageUrl('preview', 'https://example.com/og.png')!;
    assert.equal(proxiedImageUrl('preview', address), address);
  });
});

describe('without a key (before boot)', () => {
  it('hands the original URL back and verifies nothing', () => {
    setMediaProxyKey(null);
    assert.equal(proxiedImageUrl('preview', 'https://example.com/og.png'), 'https://example.com/og.png');
    assert.equal(verifiedTarget('preview', 'x', 'aHR0cHM6Ly9leGFtcGxlLmNvbQ'), null);
  });
});

describe('addresses by id', () => {
  it('build IGDB covers on the fixed host from a valid id and size only', () => {
    assert.equal(igdbCoverProxyUrl('co1abc', 'cover_big'), '/api/media-proxy/igdb/cover_big/co1abc');
    assert.equal(igdbCoverUpstream('cover_small', 'co1abc'), 'https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg');
    assert.equal(igdbCoverUpstream('t_original', 'co1abc'), null);
    assert.equal(igdbCoverUpstream('cover_big', '..%2F..%2Fx'), null);
    assert.equal(igdbCoverUpstream('cover_big', 'CO1ABC'), null);
  });

  it('build YouTube thumbnails from a video id only', () => {
    assert.equal(youtubeThumbnailUpstream('dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    assert.equal(youtubeThumbnailUpstream('dQw4w9WgXc'), null);
    assert.equal(youtubeThumbnailUpstream('dQw4w9WgXcQ/../x'), null);
  });

  it('are built by the client the same way', () => {
    const web = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../web/src/shared/lib/mediaProxy.ts'), 'utf8');
    assert.ok(web.includes(`MEDIA_PROXY_PATH = '${MEDIA_PROXY_PATH}'`));
    assert.ok(web.includes('`${MEDIA_PROXY_PATH}/igdb/${size}/${imageId}`'));
    assert.ok(web.includes('`${MEDIA_PROXY_PATH}/youtube/${videoId}`'));
    const routes = fs.readFileSync(path.resolve(import.meta.dirname, '../../../src/modules/media-proxy/mediaProxy.ts'), 'utf8');
    assert.ok(routes.includes('`${MEDIA_PROXY_PATH}/igdb/:size/:imageId`'));
    assert.ok(routes.includes('`${MEDIA_PROXY_PATH}/youtube/:videoId`'));
  });
});
