import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { decodeUntrusted, fitsDecodeLimits, MAX_FRAMES, MAX_INPUT_PIXELS, readImageHeader } from '../../src/lib/imageLimits.js';
import { gifBomb } from '../fixtures/gifBomb.js';

// 4096x4096, 5 frames: 84 megapixels from a few hundred bytes
const bomb = () => gifBomb({ width: 4096, height: 4096, frames: 5 });

describe('image decode limits', () => {
  it('reads the header of a picture past the caps without decoding it', async () => {
    const input = bomb();
    assert.ok(input.length < 1024);
    const meta = await readImageHeader(input);
    assert.deepEqual([meta.width, meta.pageHeight, meta.pages], [4096, 4096, 5]);
    assert.ok(4096 * 4096 * 5 > MAX_INPUT_PIXELS);
    assert.equal(fitsDecodeLimits(meta), false);
  });

  it('counts frames as well as pixels', async () => {
    const small = await readImageHeader(gifBomb({ width: 64, height: 64, frames: 3 }));
    assert.equal(fitsDecodeLimits(small), true);
    const long = await readImageHeader(gifBomb({ width: 64, height: 64, frames: MAX_FRAMES + 1 }));
    assert.equal(fitsDecodeLimits(long), false);
  });

  it('refuses to decode every frame past the pixel cap, but not the first alone', async () => {
    await assert.rejects(decodeUntrusted(bomb(), true).png().toBuffer(), /pixel limit/i);
    const first = await decodeUntrusted(bomb(), false).resize(16).png().toBuffer();
    assert.equal((await sharp(first).metadata()).width, 16);
  });
});
