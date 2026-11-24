import type { RoomContextValue } from '@/state/RoomContext';
import { participantMicMuted } from '@/features/calls/micState';
import { screenPresenterId } from './screenPresenter';
import type { PlaygroundPlayer } from './engine/PlaygroundEngine';

/** Everyone in the playground call, with what their nameplate shows. Read in a
 * room selector, so it runs on every room event; `samePlayers` keeps the list's
 * identity until something drawn changes. Your own mic comes from `ownMicMuted`
 * (useOwnMic, as every other own row in the app): the server's echo of it lags,
 * and while a refused mic is still "starting" it says unmuted. */
export function playgroundPlayers(room: RoomContextValue, allIds: readonly string[], conversationId: string | null, ownMicMuted: boolean): PlaygroundPlayer[] {
  const { me, participants } = room.state;
  const presenter = conversationId ? screenPresenterId(room, conversationId) : null;
  return allIds.flatMap((id) => {
    const p = participants.get(id);
    const mine = id === me.id;
    // your own deafen from the room, which flips the moment you press it, not the server's echo
    const deafened = mine ? room.deafened : (p?.deafened ?? false);
    const presenting = id === presenter;
    if (p) {
      const micMuted = mine ? ownMicMuted : participantMicMuted(p);
      return [{ id, userId: p.userId, name: p.displayName || p.name, speaking: p.speaking && !micMuted, micMuted, deafened, presenting }];
    }
    // yourself, before (or without) the server's echo of you
    if (!mine || !me.userId) return [];
    return [{ id, userId: me.userId, name: me.displayName || me.name, speaking: false, micMuted: ownMicMuted, deafened, presenting }];
  });
}

export const samePlayers = (a: readonly PlaygroundPlayer[], b: readonly PlaygroundPlayer[]) =>
  a.length === b.length && a.every((p, i) => {
    const q = b[i]!;
    return p.id === q.id && p.userId === q.userId && p.name === q.name && p.speaking === q.speaking
      && p.micMuted === q.micMuted && p.deafened === q.deafened && p.presenting === q.presenting;
  });
