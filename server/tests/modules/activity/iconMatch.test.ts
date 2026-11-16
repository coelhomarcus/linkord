import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { iconDistance } from '../../../src/modules/activity/iconMatch.js';

const square = (side: number, r: number, g: number, b: number) => sharp({ create: { width: side, height: side, channels: 3, background: { r, g, b } } }).png().toBuffer();

describe('iconDistance', () => {
  it('finds the same picture at another size close, and a different one far', async () => {
    const small = await square(32, 200, 40, 40);
    assert.ok(await iconDistance(small, await square(512, 200, 40, 40)) < 0.01);
    assert.ok(await iconDistance(small, await square(256, 20, 40, 220)) > 0.3);
  });
});
