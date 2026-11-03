import { describe, expect, it } from 'vitest';
import { computePeaks, encodeWav } from '@/features/soundboard/soundClip';

function fakeBuffer(channels: number[][]): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    getChannelData: (i: number) => Float32Array.from(channels[i]!),
  } as unknown as AudioBuffer;
}

describe('encodeWav', () => {
  it('writes the mono 16-bit PCM header the server parses', async () => {
    const view = new DataView(await encodeWav(new Float32Array([0, 0.5, -1]), 48000).arrayBuffer());
    const ascii = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(offset + i)));
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.byteLength).toBe(44 + 6);
  });

  it('scales and clamps samples into int16', async () => {
    const view = new DataView(await encodeWav(new Float32Array([1, -1, 2, 0]), 8000).arrayBuffer());
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767, 0]);
  });
});

describe('computePeaks', () => {
  it('takes the loudest sample per slice across channels, normalized to the clip', () => {
    const peaks = computePeaks(fakeBuffer([[0.1, -0.2, 0, 0], [0, 0, 0.4, -0.05]]), 2);
    expect(peaks).toEqual([0.5, 1]);
  });

  it('a silent clip stays flat instead of dividing by zero', () => {
    expect(computePeaks(fakeBuffer([[0, 0, 0, 0]]), 2)).toEqual([0, 0]);
  });
});
