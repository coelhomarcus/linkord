import { ConnectionQuality } from 'livekit-client';

export type ConnectionTone = 'good' | 'fair' | 'poor' | 'unknown';

export interface ConnectionStrength {
  /** bars lit, out of 3 */
  bars: 0 | 1 | 2 | 3;
  tone: ConnectionTone;
  label: string;
  /** why the bars sit below what the ping alone would give */
  note: string | null;
}

// Round trip to the voice server; voice stays comfortable under the first,
// talking over each other starts past the second.
export const PING_GOOD_MS = 100;
export const PING_FAIR_MS = 250;

const LABEL: Record<ConnectionTone, string> = {
  good: 'Conexão boa',
  fair: 'Conexão instável',
  poor: 'Conexão ruim',
  unknown: 'Medindo conexão…',
};

function toneFor(bars: number): ConnectionTone {
  return bars >= 3 ? 'good' : bars === 2 ? 'fair' : 'poor';
}

/** The ping sets the bars; LiveKit's own quality (which also sees packet
 * loss and jitter) can only take them down, so a low ping on a lossy
 * network doesn't show as all green. */
export function connectionStrength(pingMs: number | null, quality: ConnectionQuality, reconnecting: boolean): ConnectionStrength {
  if (reconnecting || quality === ConnectionQuality.Lost) {
    return { bars: 0, tone: 'poor', label: reconnecting ? 'Reconectando…' : 'Sem conexão', note: null };
  }
  if (pingMs === null) return { bars: 0, tone: 'unknown', label: LABEL.unknown, note: null };
  const byPing = pingMs < PING_GOOD_MS ? 3 : pingMs < PING_FAIR_MS ? 2 : 1;
  const cap = quality === ConnectionQuality.Poor ? 1 : quality === ConnectionQuality.Good ? 2 : 3;
  const bars = Math.min(byPing, cap) as 1 | 2 | 3;
  const tone = toneFor(bars);
  return { bars, tone, label: LABEL[tone], note: bars < byPing ? 'A rede está perdendo pacotes de áudio ou vídeo.' : null };
}
