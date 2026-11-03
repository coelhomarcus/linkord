// Turns whatever audio file someone picks into what the server accepts: a
// mono 16-bit PCM WAV of at most 5 seconds (server soundFile.ts). Doing the
// trim and the encoding here means the server only reads a header to know the
// real duration, and every listener downloads the same small, uniform file.

export const CLIP_SAMPLE_RATE = 48000;
// decoding a long file just to keep 5s of it is wasted memory; this is plenty
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

let decoder: AudioContext | null = null;

export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  decoder ??= new AudioContext();
  return decoder.decodeAudioData(await file.arrayBuffer());
}

/** Peak amplitude (0..1) of `bars` equal slices of the buffer, for drawing. */
export function computePeaks(buffer: AudioBuffer, bars: number): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const slice = Math.max(1, Math.floor(buffer.length / bars));
  const peaks: number[] = [];
  let max = 0;
  for (let bar = 0; bar < bars; bar++) {
    let peak = 0;
    const start = bar * slice;
    const end = Math.min(buffer.length, start + slice);
    for (const data of channels) {
      for (let i = start; i < end; i++) {
        const v = Math.abs(data[i]!);
        if (v > peak) peak = v;
      }
    }
    peaks.push(peak);
    if (peak > max) max = peak;
  }
  // normalized so a quiet clip still draws a readable shape
  return max > 0 ? peaks.map((p) => p / max) : peaks;
}

/** Mixes [startSec, endSec) down to mono at CLIP_SAMPLE_RATE. */
export async function renderClip(buffer: AudioBuffer, startSec: number, endSec: number): Promise<Float32Array> {
  const duration = Math.max(0, endSec - startSec);
  const frames = Math.max(1, Math.round(duration * CLIP_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frames, CLIP_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0, startSec, duration);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const dataSize = samples.length * 2;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
