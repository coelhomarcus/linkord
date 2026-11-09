import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { encodeSquareWebp } from '../../../src/modules/emojis/emojiFile.js';
import {
  isStickerId, parseStickerDescription, parseStickerEmoji, parseStickerName, STICKER_SIZE_PX,
} from '../../../src/modules/stickers/serverStickers.js';

describe('parseStickerName', () => {
  it('keeps one trimmed line of 2 to 30 characters, spaces and accents included', () => {
    assert.equal(parseStickerName('  abraço   de gatinho '), 'abraço de gatinho');
    assert.equal(parseStickerName('a\nb'), 'a b');
    assert.equal(parseStickerName('x'.repeat(30)), 'x'.repeat(30));
  });

  it('refuses rather than cutting a name', () => {
    for (const bad of ['a', ' ', 'x'.repeat(31), '', null, undefined]) {
      assert.equal(parseStickerName(bad), null, String(bad));
    }
  });
});

describe('parseStickerDescription', () => {
  it('is optional and capped at 100 characters', () => {
    assert.equal(parseStickerDescription(undefined), '');
    assert.equal(parseStickerDescription('  um gato  abraçando '), 'um gato abraçando');
    assert.equal(parseStickerDescription('x'.repeat(100)), 'x'.repeat(100));
    assert.equal(parseStickerDescription('x'.repeat(101)), null);
  });
});

describe('parseStickerEmoji', () => {
  it('takes exactly one Unicode emoji', () => {
    assert.equal(parseStickerEmoji(' 😺 '), '😺');
    assert.equal(parseStickerEmoji('👍🏽'), '👍🏽');
    for (const bad of ['', 'gato', '😺😺', ':cat:', null]) assert.equal(parseStickerEmoji(bad), null, String(bad));
  });
});

describe('isStickerId', () => {
  it('accepts only the 32 hex characters ids are made of', () => {
    assert.equal(isStickerId('a'.repeat(32)), true);
    assert.equal(isStickerId('A'.repeat(32)), false);
    assert.equal(isStickerId('a'.repeat(31)), false);
    assert.equal(isStickerId(42), false);
  });
});

describe('sticker encoding', () => {
  it('fits a picture whole into a transparent 320px WebP square', async () => {
    const wide = await sharp({ create: { width: 640, height: 200, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } } }).png().toBuffer();
    const result = await encodeSquareWebp(wide, { size: STICKER_SIZE_PX, maxBytes: 1024 * 1024 });
    assert.ok(typeof result !== 'string');
    const meta = await sharp(result.data).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['webp', STICKER_SIZE_PX, STICKER_SIZE_PX, true]);
  });

  it('refuses what comes out heavier than the limit', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
    assert.equal(await encodeSquareWebp(png, { size: STICKER_SIZE_PX, maxBytes: 10 }), 'too_large');
  });
});
