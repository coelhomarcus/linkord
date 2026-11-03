import { useCallback, useEffect, useRef } from 'react';
import type { ServerMessage } from '@/shared/types/protocol';
import { logger } from '@/shared/lib/logger';
import { invalidateGroupSounds } from './useGroupSounds';
import { playGroupSound } from './soundPlayback';

const log = logger.child({ component: 'soundboard' });

const FALLBACK_EMOJI = '🔊';

interface SoundboardEventsOptions {
  activeCallConversationId: string | null;
  deafened: boolean;
  showReaction: (participantId: string, emoji: string) => void;
}

/** The soundboard's half of the socket: playing what someone in this call
 * triggered, and refreshing a group's list when it changes. */
export function useSoundboardEvents({ activeCallConversationId, deafened, showReaction }: SoundboardEventsOptions) {
  const callRef = useRef({ activeCallConversationId, deafened });
  useEffect(() => { callRef.current = { activeCallConversationId, deafened }; }, [activeCallConversationId, deafened]);

  const onSoundboardPlay = useCallback((m: Extract<ServerMessage, { t: 'soundboard-play' }>) => {
    const call = callRef.current;
    // the server only sends this to the call's participants; a late one can
    // still land right after leaving or switching calls
    if (m.conversationId !== call.activeCallConversationId) return;
    showReaction(m.participantId, m.emoji || FALLBACK_EMOJI);
    if (call.deafened) return;
    playGroupSound(m.conversationId, m.soundId, m.volume).catch((err: unknown) => {
      log.warn('could not play soundboard sound', { soundId: m.soundId, err: err instanceof Error ? err.message : String(err) });
    });
  }, [showReaction]);

  const onGroupSoundsChanged = useCallback((m: Extract<ServerMessage, { t: 'group-sounds-changed' }>) => {
    invalidateGroupSounds(m.conversationId);
  }, []);

  return { onSoundboardPlay, onGroupSoundsChanged };
}
