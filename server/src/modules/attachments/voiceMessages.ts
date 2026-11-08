// Leaf module: what makes an audio attachment a voice message, checked once at
// upload init and then carried through staging and publishing as plain columns.

/** Mirrors web/src/features/voiceMessages/voiceFormat.ts#MAX_VOICE_DURATION_MS. */
export const MAX_VOICE_DURATION_MS = 5 * 60 * 1000;
// The recorder stops itself at the limit, but its clock and the encoder's last
// frame don't land on the same millisecond.
const DURATION_SLACK_MS = 2_000;
const MAX_WAVEFORM_BARS = 128;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface VoiceMeta {
  durationMs: number;
  /** base64 of one byte (0-255) per bar */
  waveform: string;
}

/** `undefined` when the upload is not a voice message, `null` when it claims
 * to be one with metadata the client could not have produced. */
export function parseVoiceMeta(raw: unknown, mimeType: string): VoiceMeta | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || !mimeType.startsWith('audio/')) return null;
  const { durationMs, waveform } = raw as Record<string, unknown>;
  if (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_VOICE_DURATION_MS + DURATION_SLACK_MS) return null;
  if (typeof waveform !== 'string' || !BASE64_RE.test(waveform)) return null;
  const bars = Buffer.from(waveform, 'base64').length;
  if (bars === 0 || bars > MAX_WAVEFORM_BARS) return null;
  return { durationMs, waveform };
}

/** The wire shape, from the two nullable columns staged and published rows share. */
export function voicePayload(row: { voiceDurationMs: number | null; voiceWaveform: string | null }): { voice: VoiceMeta } | Record<string, never> {
  return row.voiceDurationMs && row.voiceWaveform ? { voice: { durationMs: row.voiceDurationMs, waveform: row.voiceWaveform } } : {};
}
