import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { thumbHashToAverageRGBA, thumbHashToApproximateAspectRatio } from 'thumbhash';
import { readImagePlaceholder } from '../../../src/modules/attachments/attachmentThumbnails.js';

const decode = (placeholder: string) => Uint8Array.from(Buffer.from(placeholder, 'base64'));

describe('readImagePlaceholder', () => {
  test('is a few dozen bytes whose average colour is the picture\'s', async () => {
    const png = await sharp({ create: { width: 300, height: 150, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const placeholder = await readImagePlaceholder(png);
    assert.ok(placeholder);
    assert.ok(placeholder.length < 80, `a placeholder rides in every message, got ${placeholder.length} chars`);
    const { r, g, b, a } = thumbHashToAverageRGBA(decode(placeholder));
    assert.ok(r > 0.9 && g < 0.1 && b < 0.1 && a > 0.99, `average was ${[r, g, b, a].map((v) => v.toFixed(2))}`);
  });

  test('keeps the proportions of the picture as displayed, EXIF orientation applied', async () => {
    // stored 128x64, rotated by EXIF: shown 64x128
    const jpeg = await sharp({ create: { width: 128, height: 64, channels: 3, background: '#3366dd' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const placeholder = await readImagePlaceholder(jpeg);
    assert.ok(placeholder);
    // ThumbHash stores the ratio coarsely (a 1:2 picture reads ~0.57), but
    // unmistakably portrait, which is what the un-rotated 2:1 would not be
    assert.ok(Math.abs(thumbHashToApproximateAspectRatio(decode(placeholder)) - 0.5) < 0.1);
  });

  test('keeps transparency, so a see-through picture is not painted over a solid colour', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 200, b: 0, alpha: 0 } } }).png().toBuffer();
    const placeholder = await readImagePlaceholder(png);
    assert.ok(placeholder);
    assert.ok(thumbHashToAverageRGBA(decode(placeholder)).a < 0.05);
  });

  test('returns null, never throws, for something that is not an image', async () => {
    assert.equal(await readImagePlaceholder(Buffer.from('not an image at all')), null);
  });
});
