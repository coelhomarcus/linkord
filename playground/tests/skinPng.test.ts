import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { MAX_SKIN_BYTES, parseSkinPng } from '../src/skinPng.js';

function pngHeader(width: number, height: number, extra = 0): Buffer {
  const bytes = Buffer.alloc(33 + extra);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const WEB_SKINS = path.resolve(import.meta.dirname, '../../web/src/features/playground/skins/skins.ts');

describe('parseSkinPng', () => {
  it('allows the same size as the web app', () => {
    const [, a, b] = /export const MAX_SKIN_BYTES = (\d+) \* (\d+);/.exec(fs.readFileSync(WEB_SKINS, 'utf8')) ?? [];
    assert.equal(Number(a) * Number(b), MAX_SKIN_BYTES);
  });

  it('accepts a 64x64 or 64x32 PNG', () => {
    const modern = pngHeader(64, 64).toString('base64');
    assert.equal(parseSkinPng(modern), modern);
    assert.ok(parseSkinPng(pngHeader(64, 32).toString('base64')));
  });

  it('refuses other sizes, other formats and anything that is not base64', () => {
    assert.equal(parseSkinPng(pngHeader(128, 128).toString('base64')), null);
    assert.equal(parseSkinPng(Buffer.from('GIF89a'.padEnd(40, '\0')).toString('base64')), null);
    assert.equal(parseSkinPng('not base64!'), null);
    assert.equal(parseSkinPng(''), null);
    assert.equal(parseSkinPng(null), null);
    assert.equal(parseSkinPng(42), null);
  });

  it('refuses a PNG past the size a packet can carry', () => {
    assert.ok(parseSkinPng(pngHeader(64, 64, MAX_SKIN_BYTES - 40).toString('base64')));
    assert.equal(parseSkinPng(pngHeader(64, 64, MAX_SKIN_BYTES).toString('base64')), null);
  });
});
