import type { RoomContextValue } from '@/state/RoomContext';

/** Who is on the big screen of the call you are in: of everyone sharing, the
 * one with the lowest id. Two people who press share at the same instant both
 * see the same winner, so the other one steps down without anyone deciding.
 * Your own flag is read from `me`, which changes the moment you share, rather
 * than from the server's echo in `participants`. */
export function screenPresenterId(room: RoomContextValue, conversationId: string): string | null {
  const { me, participants } = room.state;
  let presenter: string | null = me.sharing ? me.id : null;
  for (const p of participants.values()) {
    if (p.id === me.id || p.callConversationId !== conversationId || !p.sharing) continue;
    if (presenter === null || p.id < presenter) presenter = p.id;
  }
  return presenter;
}
