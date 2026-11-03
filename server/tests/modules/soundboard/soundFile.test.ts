import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav } from '../../../src/modules/soundboard/soundFile.js';
import { sanitizeSoundEmoji, sanitizeSoundName, sanitizeSoundVolume } from '../../../src/modules/soundboard/soundboard.js';
import { silentWav } from './wavFixture.js';

describe('parseWav', () => {
  test('reads the duration of a mono 48kHz clip', () => {
    assert.deepEqual(parseWav(silentWav({ seconds: 1.5 })), { channels: 1, sampleRate: 48000, durationMs: 1500 });
  });

  test('handles stereo and skips unknown chunks, including the odd-size pad byte', () => {
    assert.deepEqual(parseWav(silentWav({ seconds: 2, sampleRate: 44100, channels: 2, extraChunk: true })), { channels: 2, sampleRate: 44100, durationMs: 2000 });
  });

  test('refuses float, 8-bit and out-of-range sample rates', () => {
    assert.equal(parseWav(silentWav({ seconds: 1, format: 3 })), null);
    assert.equal(parseWav(silentWav({ seconds: 1, bits: 8 })), null);
    assert.equal(parseWav(silentWav({ seconds: 1, sampleRate: 96000 })), null);
  });

  test('refuses a data chunk that claims more bytes than the file has', () => {
    const wav = silentWav({ seconds: 1 });
    assert.equal(parseWav(wav.subarray(0, wav.length - 10)), null);
  });

  test('refuses things that are not WAV at all', () => {
    assert.equal(parseWav(Buffer.from('ID3 this is an mp3 pretending to be a wav file, padded')), null);
    assert.equal(parseWav(Buffer.alloc(10)), null);
  });
});

describe('sound metadata', () => {
  test('names are single-line, trimmed and capped at 32', () => {
    assert.equal(sanitizeSoundName('  ba\n dum \t tss  '), 'ba dum tss');
    assert.equal(sanitizeSoundName('x'.repeat(40)).length, 32);
    assert.equal(sanitizeSoundName('   '), '');
  });

  test('emoji is optional but must be exactly one emoji', () => {
    assert.equal(sanitizeSoundEmoji(''), '');
    assert.equal(sanitizeSoundEmoji('🥁'), '🥁');
    assert.equal(sanitizeSoundEmoji('👍🏽'), '👍🏽');
    assert.equal(sanitizeSoundEmoji('🥁🥁'), null);
    assert.equal(sanitizeSoundEmoji('drum'), null);
  });

  test('volume clamps to 0..100 and rejects non-numbers', () => {
    assert.equal(sanitizeSoundVolume('55.4'), 55);
    assert.equal(sanitizeSoundVolume(250), 100);
    assert.equal(sanitizeSoundVolume(-3), 0);
    assert.equal(sanitizeSoundVolume('loud'), null);
    assert.equal(sanitizeSoundVolume(undefined), null);
  });
});
