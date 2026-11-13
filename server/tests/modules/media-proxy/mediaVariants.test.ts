import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { etagOf, InvalidVariantError, MAX_INPUT_PIXELS, parseVariant, PixelLimitError, PROXY_IMAGE_SIZES, renderVariant, variantKey, type Picture } from '../../../src/modules/media-proxy/mediaVariants.js';

const WEB_MIRROR = path.resolve(import.meta.dirname, '../../../../web/src/shared/lib/mediaProxy.ts');

const picture = (body: Buffer, contentType: string): Picture => ({ body, contentType, etag: etagOf(body) });
const solid = (width: number, height: number, background = '#f80') => sharp({ create: { width, height, channels: 3, background } });

async function animatedGif(width: number, height: number): Promise<Buffer> {
  const frames = await Promise.all(['#f00', '#0f0', '#00f'].map((color) => solid(width, height, color).png().toBuffer()));
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
}

describe('parseVariant', () => {
  it('no parameters: the original', () => {
    assert.equal(parseVariant({}), null);
    assert.equal(parseVariant({ u: 'abc' }), null);
  });

  it('accepts the listed sizes and the fixed values', () => {
    assert.deepEqual(parseVariant({ width: '400', format: 'webp' }), { width: 400, height: null, webp: true, quality: 'high', animated: true });
    assert.deepEqual(parseVariant({ height: '16', quality: 'low' }), { width: null, height: 16, webp: false, quality: 'low', animated: true });
    assert.deepEqual(parseVariant({ animated: 'false' }), { width: null, height: null, webp: true, quality: 'high', animated: false });
    for (const size of PROXY_IMAGE_SIZES) assert.equal(parseVariant({ width: String(size) })!.width, size);
  });

  it('refuses any size off the list and any other value', () => {
    for (const query of [
      { width: '401' }, { width: '0' }, { width: '-16' }, { width: '400.0' }, { width: '4e2' }, { width: 'abc' }, { height: '99999' },
      { format: 'png' }, { quality: 'max' }, { animated: 'true' }, { width: ['400', '800'] },
    ]) assert.throws(() => parseVariant(query), InvalidVariantError, JSON.stringify(query));
  });

  it('gives one key per distinct variant', () => {
    assert.notEqual(variantKey(parseVariant({ width: '400' })!), variantKey(parseVariant({ width: '400', format: 'webp' })!));
    assert.equal(variantKey(parseVariant({ format: 'webp', width: '400' })!), variantKey(parseVariant({ width: '400', format: 'webp' })!));
  });

  it('matches the web mirror size for size', () => {
    const source = fs.readFileSync(WEB_MIRROR, 'utf8');
    const list = /PROXY_IMAGE_SIZES = \[([^\]]+)\]/.exec(source)![1]!.split(',').map((n) => Number(n.trim()));
    assert.deepEqual(list, [...PROXY_IMAGE_SIZES]);
  });
});

describe('renderVariant', () => {
  it('fits inside the asked size, keeping proportions, as WebP', async () => {
    const original = picture(await solid(1200, 600).jpeg().toBuffer(), 'image/jpeg');
    const out = await renderVariant(original, parseVariant({ width: '400', format: 'webp' })!);
    const meta = await sharp(out.body).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, out.contentType], ['webp', 400, 200, 'image/webp']);
    assert.notEqual(out.etag, original.etag);
  });

  it('never enlarges, and keeps the format when WebP is not asked for', async () => {
    const original = picture(await solid(100, 50).png().toBuffer(), 'image/png');
    const out = await renderVariant(original, parseVariant({ width: '1920' })!);
    const meta = await sharp(out.body).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, out.contentType], ['png', 100, 50, 'image/png']);
  });

  it('a GIF asked for still gives one WebP frame; otherwise it stays animated', async () => {
    const original = picture(await animatedGif(64, 32), 'image/gif');
    assert.equal((await sharp(original.body, { animated: true }).metadata()).pages, 3);
    const still = await renderVariant(original, parseVariant({ width: '32', animated: 'false' })!);
    const stillMeta = await sharp(still.body, { animated: true }).metadata();
    assert.deepEqual([stillMeta.format, stillMeta.pages ?? 1, stillMeta.width, still.contentType], ['webp', 1, 32, 'image/webp']);
    const moving = await renderVariant(original, parseVariant({ width: '32', format: 'webp' })!);
    assert.equal((await sharp(moving.body, { animated: true }).metadata()).pages, 3);
  });

  it('keeps the original when the variant would not be smaller, except for a still frame', async () => {
    // a heavily compressed JPEG: re-encoding it at quality 80 only adds bytes
    const noisy = sharp({ create: { width: 900, height: 300, channels: 3, background: '#3a6', noise: { type: 'gaussian', mean: 128, sigma: 40 } } });
    const squeezed = picture(await noisy.jpeg({ quality: 5 }).toBuffer(), 'image/jpeg');
    assert.equal(await renderVariant(squeezed, parseVariant({ width: '800', format: 'webp' })!), squeezed);
    const gif = picture(await animatedGif(16, 16), 'image/gif');
    const still = await renderVariant(gif, parseVariant({ animated: 'false' })!);
    assert.equal((await sharp(still.body, { animated: true }).metadata()).pages ?? 1, 1);
  });

  it('refuses a picture whose decoded size passes the pixel limit', async () => {
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 10;
    // a flat PNG compresses to a few KB however many pixels it claims
    const bomb = picture(await solid(side, side).png({ compressionLevel: 9 }).toBuffer(), 'image/png');
    assert.ok(bomb.body.length < 1024 * 1024);
    await assert.rejects(renderVariant(bomb, parseVariant({ width: '400' })!), PixelLimitError);
  });

  it('gives the original back when sharp cannot read it (an ICO)', async () => {
    const ico = picture(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), 'image/x-icon');
    assert.equal(await renderVariant(ico, parseVariant({ width: '32', format: 'webp' })!), ico);
  });
});
