import { describe, expect, it } from 'vitest';
import { CLOUD_CELL, cloudGeometry } from '@/features/playground/engine/clouds';
import type { CloudCover } from '@/features/playground/engine/clouds';

function cover(rows: string[]): CloudCover {
  const filled = new Uint8Array(rows.length * rows[0]!.length);
  rows.forEach((row, z) => [...row].forEach((cell, x) => { filled[z * row.length + x] = cell === '#' ? 1 : 0; }));
  return { width: rows[0]!.length, height: rows.length, filled };
}

const quads = (geometry: ReturnType<typeof cloudGeometry>) => geometry.getIndex()!.count / 6;

describe('cloudGeometry', () => {
  it('builds a lone cell as a closed box', () => {
    expect(quads(cloudGeometry(cover(['....', '.#..', '....', '....']), 1, 1, 0))).toBe(6);
  });

  it('joins neighbouring cells into one surface, with no wall between them', () => {
    // two cells side by side: 2 tops, 2 bottoms, and 6 outer sides instead of 8
    expect(quads(cloudGeometry(cover(['....', '.##.', '....', '....']), 1, 1, 1))).toBe(10);
  });

  it('wraps the pattern around, and places cells a cell size apart', () => {
    const geometry = cloudGeometry(cover(['#...', '....', '....', '....']), 3, 3, 1);
    const xs = new Set(Array.from(geometry.getAttribute('position').array).filter((_, i) => i % 3 === 0));
    expect([...xs].sort((a, b) => a - b)).toEqual([CLOUD_CELL, CLOUD_CELL * 2]);
  });
});
