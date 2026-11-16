import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { largestIcoImage } from '../../../src/modules/activity/icoImage.js';

/** A 32-bit bitmap entry: BITMAPINFOHEADER, bottom-up BGRA rows, then an empty 1-bit mask. */
function bitmap(side: number, bgra: (x: number, y: number) => [number, number, number, number]): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(side, 4); header.writeInt32LE(side * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14);
  const pixels = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) Buffer.from(bgra(x, side - 1 - y)).copy(pixels, (y * side + x) * 4);
  return Buffer.concat([header, pixels, Buffer.alloc(Math.ceil(side / 32) * 4 * side)]);
}

function ico(images: { side: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + images.length * 16);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((image, i) => {
    const at = 6 + i * 16;
    head[at] = image.side >= 256 ? 0 : image.side; head[at + 1] = head[at]!;
    head.writeUInt16LE(1, at + 4); head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(image.data.length, at + 8); head.writeUInt32LE(offset, at + 12);
    offset += image.data.length;
  });
  return Buffer.concat([head, ...images.map((image) => image.data)]);
}

describe('largestIcoImage', () => {
  it('takes the largest entry, a PNG as is', async () => {
    const png = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
    const found = await largestIcoImage(ico([{ side: 16, data: bitmap(16, () => [0, 0, 255, 255]) }, { side: 256, data: png }]));
    assert.equal(found?.size, 256);
    assert.ok(found?.png.equals(png));
  });

  it('decodes a 32-bit bitmap the right way up, with its colours and alpha', async () => {
    // top row red and opaque, the rest blue and half transparent
    const found = await largestIcoImage(ico([{ side: 4, data: bitmap(4, (_x, y) => (y === 0 ? [0, 0, 255, 255] : [255, 0, 0, 128])) }]));
    assert.equal(found?.size, 4);
    const { data } = await sharp(found!.png).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([...data.subarray(0, 4)], [255, 0, 0, 255]);
    assert.deepEqual([...data.subarray(4 * 4 * 3, 4 * 4 * 3 + 4)], [0, 0, 255, 128]);
  });

  it('shows opaque a bitmap that leaves its alpha empty', async () => {
    const found = await largestIcoImage(ico([{ side: 2, data: bitmap(2, () => [0, 255, 0, 0]) }]));
    const { data } = await sharp(found!.png).raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[3], 255);
  });

  it('skips a broken entry for the next size down, and reads nothing from what is not an .ico', async () => {
    const found = await largestIcoImage(ico([{ side: 256, data: Buffer.from('not a picture at all, not even close') }, { side: 8, data: bitmap(8, () => [1, 2, 3, 255]) }]));
    assert.equal(found?.size, 8);
    assert.equal(await largestIcoImage(Buffer.from('GIF89a')), null);
  });
});
