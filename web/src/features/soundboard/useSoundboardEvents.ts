import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServerMessage } from '@/shared/types/protocol';
import { logger } from '@/shared/lib/logger';
import { invalidateServerSounds } from './useServerSounds';
import { invalidateMySounds } from './useMySounds';
import { playServerSound } from './soundPlayback';

const log = logger.child({ component: 'soundboard' });

const FALLBACK_EMOJI = '🔊';
const FLOAT_DURATION_MS = 3000;

export interface FloatingSoundEmoji {
  key: number;
  participantId: string;
  emoji: string;
  /** horizontal position, as a % of the screen */
  left: number;
}

interface SoundboardEventsOptions {
  activeCallConversationId: string | null;
  deafened: boolean;
}

/** The soundboard's half of the socket: playing what someone in this call
 * triggered (its emoji floats up the screen, even while deafened), and
 * refreshing a group's list when it changes. */
export function useSoundboardEvents({ activeCallConversationId, deafened }: SoundboardEventsOptions) {
  const callRef = useRef({ activeCallConversationId, deafened });
  useEffect(() => { callRef.current = { activeCallConversationId, deafened }; }, [activeCallConversationId, deafened]);
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingSoundEmoji[]>([]);
  const floatKeyRef = useRef(0);

  const floatEmoji = useCallback((participantId: string, emoji: string) => {
    const key = floatKeyRef.current++;
    const left = 12 + Math.random() * 76;
    setFloatingEmojis((prev) => [...prev, { key, participantId, emoji, left }]);
    setTimeout(() => setFloatingEmojis((prev) => prev.filter((e) => e.key !== key)), FLOAT_DURATION_MS);
  }, []);

  const onSoundboardPlay = useCallback((m: Extract<ServerMessage, { t: 'soundboard-play' }>) => {
    const call = callRef.current;
    // the server only sends this to the call's participants; a late one can
    // still land right after leaving or switching calls
    if (m.conversationId !== call.activeCallConversationId) return;
    floatEmoji(m.participantId, m.emoji || FALLBACK_EMOJI);
    if (call.deafened) return;
    playServerSound(m.serverId, m.soundId, m.volume, m.fileToken).catch((err: unknown) => {
      log.warn('could not play soundboard sound', { soundId: m.soundId, err: err instanceof Error ? err.message : String(err) });
    });
  }, [floatEmoji]);

  const onServerSoundsChanged = useCallback((m: Extract<ServerMessage, { t: 'server-sounds-changed' }>) => {
    invalidateServerSounds(m.serverId);
    invalidateMySounds();
  }, []);

  return { floatingEmojis, onSoundboardPlay, onServerSoundsChanged };
}
