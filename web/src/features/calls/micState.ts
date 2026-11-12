import type { Participant } from '@/shared/types/protocol';
import { useRoom } from '@/state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';

export interface OwnMic {
  activated: boolean;
  muted: boolean;
  /** The mic a join opens is not published yet (permission prompt, device
   * opening, LiveKit connecting). */
  starting: boolean;
}

/** The account's own mic as the call UI shows it. Until a join's mic is
 * published there is nothing to read it from, and it would show as muted for
 * that whole wait; meanwhile it shows what the join is about to do. */
export function useOwnMic(): OwnMic {
  const { state, micStarting, preferMuted, deafened } = useRoom();
  const media = useParticipantMedia(state.me.id ?? '');
  const starting = micStarting && !media.micActivated;
  return { activated: media.micActivated, muted: starting ? preferMuted || deafened : media.micMuted, starting };
}

/** Someone else's mic from the server's mirror. While it is starting,
 * `micMuted` is what their join asked for; an older server never sends
 * `micStarting`. */
export function participantMicMuted(p: Pick<Participant, 'micActivated' | 'micMuted' | 'micStarting'>): boolean {
  if (p.micStarting && !p.micActivated) return p.micMuted;
  return !p.micActivated || p.micMuted;
}
