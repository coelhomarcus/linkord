import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_VOICE_DURATION_MS, parseVoiceMeta, voicePayload } from '../../../src/modules/attachments/voiceMessages.js';

const waveform = Buffer.from([0, 128, 255]).toString('base64');

describe('parseVoiceMeta', () => {
  it('an upload without voice metadata is not a voice message', () => {
    assert.equal(parseVoiceMeta(undefined, 'audio/webm'), undefined);
    assert.equal(parseVoiceMeta(null, 'image/png'), undefined);
  });

  it('accepts what the recorder produces', () => {
    assert.deepEqual(parseVoiceMeta({ durationMs: 4200, waveform }, 'audio/webm'), { durationMs: 4200, waveform });
    assert.deepEqual(parseVoiceMeta({ durationMs: MAX_VOICE_DURATION_MS + 1500, waveform }, 'audio/mp4'), { durationMs: MAX_VOICE_DURATION_MS + 1500, waveform });
  });

  it('refuses a voice flag on a file that is not audio', () => {
    assert.equal(parseVoiceMeta({ durationMs: 4200, waveform }, 'image/png'), null);
  });

  it('refuses durations the recorder cannot produce', () => {
    for (const durationMs of [0, -1, 1.5, MAX_VOICE_DURATION_MS + 60_000, '4200', Number.NaN]) {
      assert.equal(parseVoiceMeta({ durationMs, waveform }, 'audio/webm'), null, String(durationMs));
    }
  });

  it('refuses a waveform that is empty, not base64, or longer than the player draws', () => {
    for (const bad of ['', '***', Buffer.alloc(129, 1).toString('base64'), 42]) {
      assert.equal(parseVoiceMeta({ durationMs: 1000, waveform: bad }, 'audio/webm'), null, String(bad));
    }
  });
});

describe('voicePayload', () => {
  it('spreads into the attachment only when both columns are set', () => {
    assert.deepEqual(voicePayload({ voiceDurationMs: 1000, voiceWaveform: waveform }), { voice: { durationMs: 1000, waveform } });
    assert.deepEqual(voicePayload({ voiceDurationMs: null, voiceWaveform: null }), {});
    assert.deepEqual(voicePayload({ voiceDurationMs: 1000, voiceWaveform: null }), {});
  });
});
