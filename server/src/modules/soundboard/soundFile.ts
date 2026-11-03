// The browser trims and re-encodes every sound to 16-bit PCM WAV before
// upload (see web soundClip.ts). Accepting only that one format lets the
// server check the real duration from the header alone, with no decoder:
// compressed formats would need one just to know how long a clip is.

export interface WavInfo {
  channels: number;
  sampleRate: number;
  durationMs: number;
}

const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 48000;

/** Reads a canonical PCM WAV header; null for anything else (wrong magic,
 * compressed or float audio, a data chunk that runs past the end). */
export function parseWav(buffer: Buffer): WavInfo | null {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buffer.length) return null;
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      if (!format || body + size > buffer.length) return null;
      const { audioFormat, channels, sampleRate, bitsPerSample } = format;
      if (audioFormat !== 1 || bitsPerSample !== 16) return null;
      if (channels < 1 || channels > 2) return null;
      if (sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) return null;
      const frames = size / (channels * 2);
      if (frames < 1) return null;
      return { channels, sampleRate, durationMs: Math.round((frames / sampleRate) * 1000) };
    }
    // chunks are word-aligned: an odd size carries one pad byte
    offset = body + size + (size % 2);
  }
  return null;
}
