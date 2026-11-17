/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// A size relative to the text around it (`text-[0.875em]` for inline code) follows the scale on its own.
const ABSOLUTE_SIZE = /(?<![\w-])(?:text-\[(?:length:)?\d*\.?\d+(?:px|rem)\]|leading-\[\d*\.?\d+(?:px|rem)?\])/g;
const MARKER = 'off-scale:';
const COMMENT = /^\s*(?:\/\/|\/\*|\{\/\*|\*)/;

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, file));
}

/** The line itself, or the comment lines right above it, explain why it is off the scale. */
function explained(lines: string[], index: number): boolean {
  if (lines[index]!.includes(MARKER)) return true;
  for (let above = index - 1; above >= 0 && COMMENT.test(lines[above]!); above--) {
    if (lines[above]!.includes(MARKER)) return true;
  }
  return false;
}

describe('type scale', () => {
  it('sizes text from the --text-* steps, except glyphs and icons marked off-scale', () => {
    const root = join(process.cwd(), 'src');
    const unexplained: string[] = [];
    for (const file of sources(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const [match] of line.matchAll(ABSOLUTE_SIZE)) {
          if (!explained(lines, index)) unexplained.push(`${file.slice(root.length + 1)}:${index + 1} ${match}`);
        }
      });
    }
    expect(unexplained, 'use a text-* step, or say why it is not text with an "off-scale:" comment').toEqual([]);
  });
});
