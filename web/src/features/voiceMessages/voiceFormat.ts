/** Mirrors server/src/modules/attachments/voiceMessages.ts#MAX_VOICE_DURATION_MS. */
export const MAX_VOICE_DURATION_MS = 5 * 60 * 1000;
export const WAVEFORM_BARS = 48;

// AAC in MP4 first: it is the one container every browser plays back,
// Safari included (Safari's WebM/Opus support depends on the OS version).
// Chrome records MP4 only in recent versions and Firefox not at all, so
// WebM/Opus is the usual fallback.
const RECORDER_MIME_PREFERENCE = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

/** The formats this browser says it records, best first; [''] lets it pick
 * its own. Saying so isn't proof: a Chromium built without the AAC encoder
 * accepts MP4 and then fails with EncodingError, so the recorder falls back
 * down this list. */
export function recorderMimeCandidates(isTypeSupported: (type: string) => boolean): string[] {
  const supported = RECORDER_MIME_PREFERENCE.filter((type) => {
    try { return isTypeSupported(type); } catch { return false; }
  });
  return supported.length ? supported : [''];
}

const EXTENSIONS: Record<string, string> = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };

export function baseMime(mime: string): string {
  return mime.split(';')[0]!.trim().toLowerCase();
}

/** e.g. `voice-message-20261108-142530.m4a`, in local time. */
export function voiceFileName(mime: string, at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `voice-message-${stamp}.${EXTENSIONS[baseMime(mime)] ?? 'webm'}`;
}

/** Averages the levels sampled while recording (0..1 each) into `bars`
 * buckets and scales them so the loudest bar is full height. */
export function resampleLevels(levels: readonly number[], bars = WAVEFORM_BARS): number[] {
  if (!levels.length) return new Array<number>(bars).fill(0);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    const start = Math.floor((i * levels.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / bars));
    let sum = 0;
    for (let j = start; j < end; j++) sum += levels[Math.min(j, levels.length - 1)]!;
    out.push(sum / (end - start));
  }
  const peak = Math.max(...out);
  return peak > 0 ? out.map((value) => Math.min(1, value / peak)) : out;
}

export function encodeWaveform(bars: readonly number[]): string {
  let binary = '';
  for (const value of bars) binary += String.fromCharCode(Math.round(Math.min(1, Math.max(0, value)) * 255));
  return btoa(binary);
}

/** 0..1 per bar; an unreadable value reads as a flat line instead of throwing. */
export function decodeWaveform(encoded: string): number[] {
  try {
    const binary = atob(encoded);
    return Array.from(binary, (char) => char.charCodeAt(0) / 255);
  } catch {
    return new Array<number>(WAVEFORM_BARS).fill(0);
  }
}

/** m:ss, for both the recording clock and the player. */
export function formatVoiceDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
