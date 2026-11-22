import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { badgeLabel, badgeSize, drawBadge, layoutText, parseBadgeCount } from '../../src/main/badge.js';

const pixel = (bitmap: ReturnType<typeof drawBadge>, x: number, y: number) => {
  const offset = (y * bitmap.size + x) * 4;
  const [b, g, r, a] = bitmap.data.subarray(offset, offset + 4);
  return { r, g, b, a };
};

describe('parseBadgeCount', () => {
  it('takes a whole, non-negative count', () => {
    assert.equal(parseBadgeCount(0), 0);
    assert.equal(parseBadgeCount(12), 12);
    assert.equal(parseBadgeCount(123_456), 123_456);
  });

  it('refuses anything else', () => {
    for (const value of [-1, 1.5, Number.NaN, Infinity, '3', null, undefined, {}]) assert.equal(parseBadgeCount(value), null, String(value));
  });
});

describe('badgeLabel', () => {
  it('shows nothing when everything is read', () => {
    assert.equal(badgeLabel(0), null);
  });

  it('shows the count up to 99, then 99+', () => {
    assert.equal(badgeLabel(1), '1');
    assert.equal(badgeLabel(42), '42');
    assert.equal(badgeLabel(99), '99');
    assert.equal(badgeLabel(100), '99+');
    assert.equal(badgeLabel(5000), '99+');
  });
});

describe('badgeSize', () => {
  it('follows the display scaling from the 16 px overlay', () => {
    assert.equal(badgeSize(1), 16);
    assert.equal(badgeSize(1.25), 20);
    assert.equal(badgeSize(1.5), 24);
    assert.equal(badgeSize(2), 32);
  });

  it('stays within sensible bounds', () => {
    assert.equal(badgeSize(0.5), 16);
    assert.equal(badgeSize(10), 64);
    assert.equal(badgeSize(Number.NaN), 16);
    assert.equal(badgeSize(0), 16);
  });
});

describe('layoutText', () => {
  it('fits every label at every size, inside the circle', () => {
    for (const size of [16, 20, 24, 32, 48, 64]) {
      for (const label of ['1', '8', '42', '99', '99+']) {
        const layout = layoutText(label, size);
        assert.ok(layout, `${label} at ${size}`);
        assert.ok(layout.width <= size * 0.75 && layout.height <= size * 0.6, `${label} at ${size}`);
      }
    }
  });

  it('uses the finer font unless it would not fit or come out tiny', () => {
    assert.equal(layoutText('99', 16)?.font.height, 7);
    assert.equal(layoutText('42', 24)?.font.height, 7);
    assert.equal(layoutText('9', 32)?.scale, 2);
    assert.equal(layoutText('99+', 16)?.font.height, 5);
    assert.deepEqual({ ...layoutText('99+', 32), font: undefined }, { font: undefined, scale: 2, width: 22, height: 10 });
  });
});

describe('drawBadge', () => {
  it('is a square BGRA bitmap of the asked size', () => {
    const bitmap = drawBadge('3', 20);
    assert.equal(bitmap.size, 20);
    assert.equal(bitmap.data.length, 20 * 20 * 4);
  });

  it('draws an opaque red disc with transparent corners', () => {
    const bitmap = drawBadge('1', 16);
    assert.deepEqual(pixel(bitmap, 0, 0), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepEqual(pixel(bitmap, 15, 15), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepEqual(pixel(bitmap, 8, 1), { r: 218, g: 55, b: 60, a: 255 });
  });

  it('smooths the edge with premultiplied colour', () => {
    const bitmap = drawBadge('7', 32);
    let partial = 0;
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const { r, g, b, a } = pixel(bitmap, x, y);
        assert.ok(r <= a && g <= a && b <= a, `${x},${y}`);
        if (a > 0 && a < 255) partial += 1;
      }
    }
    assert.ok(partial > 0);
  });

  it('writes the label in white, centred', () => {
    // "1" in the 5x7 font has a solid stem down its middle column
    const bitmap = drawBadge('1', 16);
    assert.deepEqual(pixel(bitmap, 8, 8), { r: 255, g: 255, b: 255, a: 255 });
    const whites = (label: string) => {
      const drawn = drawBadge(label, 16);
      let count = 0;
      for (let i = 0; i < drawn.data.length; i += 4) if (drawn.data[i] === 255 && drawn.data[i + 2] === 255) count += 1;
      return count;
    };
    assert.ok(whites('8') > whites('1'));
    assert.ok(whites('99+') > 0);
  });
});
