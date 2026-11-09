import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { EMOJI_SIZE_PX, encodeEmoji } from '../../../src/modules/emojis/emojiFile.js';

function solid(width: number, height: number) {
  return sharp({ create: { width, height, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } });
}

/** A two-frame GIF: two frames stacked in one raw bitmap, cut by pageHeight. */
function twoFrameGif(): Promise<Buffer> {
  const width = 64;
  const frame = width * width * 4;
  const pixels = Buffer.alloc(frame * 2, 0);
  pixels.fill(255, 0, frame);
  return sharp(pixels, { raw: { width, height: width * 2, channels: 4, pageHeight: width } }).gif({ delay: [100, 100], loop: 0 }).toBuffer();
}

describe('encodeEmoji', () => {
  it('turns a still image into a 128px WebP', async () => {
    const result = await encodeEmoji(await solid(300, 200).png().toBuffer());
    assert.ok(typeof result !== 'string');
    assert.equal(result.animated, false);
    const meta = await sharp(result.data).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['webp', EMOJI_SIZE_PX, EMOJI_SIZE_PX]);
  });

  it('keeps an animated GIF animated, as WebP', async () => {
    const result = await encodeEmoji(await twoFrameGif());
    assert.ok(typeof result !== 'string');
    assert.equal(result.animated, true);
    const meta = await sharp(result.data, { animated: true }).metadata();
    assert.deepEqual([meta.format, meta.width, meta.pageHeight, meta.pages], ['webp', EMOJI_SIZE_PX, EMOJI_SIZE_PX, 2]);
  });

  it('reads what the bytes are, not what they claim', async () => {
    assert.equal(await encodeEmoji(Buffer.from('definitely not an image')), 'invalid_image');
    // SVG is an image sharp can read, but not one an emoji may be
    assert.equal(await encodeEmoji(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')), 'invalid_image');
  });

  it('refuses a source past the size it accepts', async () => {
    assert.equal(await encodeEmoji(await solid(5000, 10).png().toBuffer()), 'invalid_image');
  });
});
