import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { MAX_FRAMES } from '../../../src/lib/imageLimits.js';
import { generateThumbnail, readImageDimensions } from '../../../src/modules/attachments/attachmentThumbnails.js';
import { gifBomb } from '../../fixtures/gifBomb.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'overcord-thumbnail-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function write(name: string, bytes: Buffer): Promise<string> {
  const file = path.join(dir, name);
  await fs.writeFile(file, bytes);
  return file;
}

describe('generateThumbnail', () => {
  test('shrinks a large picture to fit 640px', async () => {
    const file = await write('wide.png', await sharp({ create: { width: 1600, height: 400, channels: 3, background: '#3366dd' } }).png().toBuffer());
    const thumb = await generateThumbnail(file);
    assert.ok(thumb);
    const meta = await sharp(thumb.buffer).metadata();
    assert.deepEqual([thumb.mime, meta.width, meta.height], ['image/jpeg', 640, 160]);
  });

  test('skips an animation past the pixel cap, which still gets its size', async () => {
    // 84 megapixels across its frames, from a few hundred bytes
    const file = await write('bomb.gif', gifBomb({ width: 4096, height: 4096, frames: 5 }));
    assert.equal(await generateThumbnail(file), null);
    assert.deepEqual(await readImageDimensions(file), { width: 4096, height: 4096 });
  });

  test('skips an animation of more frames than allowed', async () => {
    const file = await write('long.gif', gifBomb({ width: 700, height: 10, frames: MAX_FRAMES + 1 }));
    assert.equal(await generateThumbnail(file), null);
  });
});
