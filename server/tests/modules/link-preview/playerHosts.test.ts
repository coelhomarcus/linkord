import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { PLAYER_HOSTS } from '../../../src/modules/link-preview/playerHosts.js';
import { isAllowlistedPlayer } from '../../../src/modules/link-preview/preview.js';

const WEB_PLAYER = path.resolve(import.meta.dirname, '../../../../web/src/features/media/linkPlayer.ts');

describe('player hosts', () => {
  it('lists the same hosts as the web client, which draws their players', () => {
    const source = fs.readFileSync(WEB_PLAYER, 'utf8');
    const list = /PLAYER_HOSTS = \[([^\]]*)\]/.exec(source)?.[1] ?? '';
    assert.deepEqual([...list.matchAll(/'([^']+)'/g)].map((m) => m[1]), [...PLAYER_HOSTS]);
  });

  it('allows a host and its subdomains over https only', () => {
    assert.equal(isAllowlistedPlayer('https://player.vimeo.com/video/1'), true);
    assert.equal(isAllowlistedPlayer('https://w.soundcloud.com/player/?url=x'), true);
    assert.equal(isAllowlistedPlayer('https://streamable.com/e/abc'), true);
    assert.equal(isAllowlistedPlayer('http://player.vimeo.com/video/1'), false);
    assert.equal(isAllowlistedPlayer('https://vimeo.com.evil.example/video/1'), false);
    assert.equal(isAllowlistedPlayer('https://notvimeo.com/video/1'), false);
  });
});
