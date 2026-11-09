import { describe, expect, it } from 'vitest';
import { decodeWaveform, encodeWaveform, formatVoiceDuration, recorderMimeCandidates, resampleLevels, voiceFileName, WAVEFORM_BARS } from '@/features/voiceMessages/voiceFormat';

describe('recorderMimeCandidates', () => {
  it('puts AAC in MP4 first, the one format every browser plays back', () => {
    expect(recorderMimeCandidates(() => true)).toEqual(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']);
  });

  it('offers only WebM/Opus where MP4 cannot be recorded (Firefox)', () => {
    expect(recorderMimeCandidates((type) => type.startsWith('audio/webm'))).toEqual(['audio/webm;codecs=opus', 'audio/webm']);
  });

  it('lets the browser choose when none is supported, or the check throws', () => {
    expect(recorderMimeCandidates(() => false)).toEqual(['']);
    expect(recorderMimeCandidates(() => { throw new Error('nope'); })).toEqual(['']);
  });
});

describe('waveform', () => {
  it('averages the readings into buckets and scales the loudest to full height', () => {
    expect(resampleLevels([0.1, 0.1, 0.2, 0.2], 2)).toEqual([0.5, 1]);
  });

  it('stretches a take shorter than the bar count instead of leaving gaps', () => {
    const bars = resampleLevels([0.2, 0.4], 4);
    expect(bars).toHaveLength(4);
    expect(bars.every((value) => value > 0)).toBe(true);
  });

  it('is a flat line for silence or no readings at all', () => {
    expect(resampleLevels([0, 0, 0], 3)).toEqual([0, 0, 0]);
    expect(resampleLevels([], 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it('round-trips through base64 within one byte of precision', () => {
    const bars = resampleLevels(Array.from({ length: 300 }, (_, i) => (i % 10) / 10));
    expect(bars).toHaveLength(WAVEFORM_BARS);
    const decoded = decodeWaveform(encodeWaveform(bars));
    decoded.forEach((value, i) => expect(Math.abs(value - bars[i]!)).toBeLessThanOrEqual(1 / 255));
  });

  it('reads a corrupt waveform as a flat line instead of throwing', () => {
    expect(decodeWaveform('***')).toEqual(new Array(WAVEFORM_BARS).fill(0));
  });
});

describe('voiceFileName / formatVoiceDuration', () => {
  it('names the file by local time with the extension of the recorded container', () => {
    const at = new Date(2026, 10, 8, 14, 5, 9);
    expect(voiceFileName('audio/mp4;codecs=mp4a.40.2', at)).toBe('voice-message-20261108-140509.m4a');
    expect(voiceFileName('audio/webm;codecs=opus', at)).toBe('voice-message-20261108-140509.webm');
    expect(voiceFileName('audio/ogg', at)).toBe('voice-message-20261108-140509.ogg');
  });

  it('formats as m:ss', () => {
    expect(formatVoiceDuration(0)).toBe('0:00');
    expect(formatVoiceDuration(9_999)).toBe('0:09');
    expect(formatVoiceDuration(5 * 60 * 1000)).toBe('5:00');
  });
});
