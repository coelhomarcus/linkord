import { ConnectionQuality } from 'livekit-client';
import { i18n } from '@/shared/i18n/init';

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
const PING_GOOD_MS = 100;
const PING_FAIR_MS = 250;

const LABEL_KEYS: Record<ConnectionTone, 'calls:connection.good' | 'calls:connection.fair' | 'calls:connection.poor' | 'calls:connection.unknown'> = {
  good: 'calls:connection.good',
  fair: 'calls:connection.fair',
  poor: 'calls:connection.poor',
  unknown: 'calls:connection.unknown',
};

function toneFor(bars: number): ConnectionTone {
  return bars >= 3 ? 'good' : bars === 2 ? 'fair' : 'poor';
}

/** The ping sets the bars; LiveKit's own quality (which also sees packet
 * loss and jitter) can only take them down, so a low ping on a lossy
 * network doesn't show as all green. */
export function connectionStrength(pingMs: number | null, quality: ConnectionQuality, reconnecting: boolean): ConnectionStrength {
  if (reconnecting || quality === ConnectionQuality.Lost) {
    return { bars: 0, tone: 'poor', label: i18n.t(reconnecting ? 'calls:connection.reconnecting' : 'calls:connection.offline'), note: null };
  }
  if (pingMs === null) return { bars: 0, tone: 'unknown', label: i18n.t(LABEL_KEYS.unknown), note: null };
  const byPing = pingMs < PING_GOOD_MS ? 3 : pingMs < PING_FAIR_MS ? 2 : 1;
  const cap = quality === ConnectionQuality.Poor ? 1 : quality === ConnectionQuality.Good ? 2 : 3;
  const bars = Math.min(byPing, cap) as 1 | 2 | 3;
  const tone = toneFor(bars);
  return { bars, tone, label: i18n.t(LABEL_KEYS[tone]), note: bars < byPing ? i18n.t('calls:connection.packetLoss') : null };
}
