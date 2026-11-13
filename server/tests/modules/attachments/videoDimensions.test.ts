import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseVideoDimensions } from '../../../src/modules/attachments/videoDimensions.js';

describe('parseVideoDimensions', () => {
  it('an upload without a size says nothing', () => {
    assert.equal(parseVideoDimensions(undefined, 'video/mp4'), undefined);
    assert.equal(parseVideoDimensions(null, 'image/png'), undefined);
  });

  it('accepts the size a browser reads from a video', () => {
    assert.deepEqual(parseVideoDimensions({ width: 1080, height: 1920 }, 'video/mp4'), { width: 1080, height: 1920 });
    assert.deepEqual(parseVideoDimensions({ width: 16_384, height: 1 }, 'video/webm'), { width: 16_384, height: 1 });
  });

  it('keeps only the two sides', () => {
    assert.deepEqual(parseVideoDimensions({ width: 640, height: 360, extra: 'x' }, 'video/mp4'), { width: 640, height: 360 });
  });

  it('refuses a size on a file that is not a video', () => {
    assert.equal(parseVideoDimensions({ width: 640, height: 360 }, 'image/png'), null);
    assert.equal(parseVideoDimensions({ width: 640, height: 360 }, 'audio/webm'), null);
  });

  it('refuses sides no video has', () => {
    for (const bad of [0, -1, 1.5, 16_385, '640', Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      assert.equal(parseVideoDimensions({ width: bad, height: 360 }, 'video/mp4'), null, String(bad));
      assert.equal(parseVideoDimensions({ width: 640, height: bad }, 'video/mp4'), null, String(bad));
    }
  });

  it('refuses something that is not an object', () => {
    assert.equal(parseVideoDimensions('640x360', 'video/mp4'), null);
    assert.equal(parseVideoDimensions(640, 'video/mp4'), null);
  });
});
