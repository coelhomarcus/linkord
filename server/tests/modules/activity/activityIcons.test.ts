import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { activityIconPath, storeActivityIcon } from '../../../src/modules/activity/activityIcons.js';

async function png(color: { r: number; g: number; b: number }, size = 48): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...color, alpha: 1 } } }).png().toBuffer();
}

describe('storeActivityIcon', () => {
  test('stores a 96px WebP under the hash of what it stored, once for the same picture', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-icons-'));
    try {
      const first = await storeActivityIcon(await png({ r: 30, g: 200, b: 90 }), dir);
      const again = await storeActivityIcon(await png({ r: 30, g: 200, b: 90 }), dir);
      assert.ok(typeof first === 'object');
      assert.deepEqual(again, first);
      const meta = await sharp(await fs.readFile(activityIconPath(first.id, dir))).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, 96);
      assert.equal((await fs.readdir(dir)).length, 1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('refuses what is not a picture', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'activity-icons-'));
    try {
      assert.equal(await storeActivityIcon(Buffer.from('<svg onload="x"></svg>'), dir), 'invalid_image');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
