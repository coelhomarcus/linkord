import { useState } from 'react';
import { useRoomSelector } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Participant } from '@/shared/types/protocol';

/** What a participant is doing with their media: changes many times a second in a call (`speaking`). */
const MEDIA_FIELDS = ['deafened', 'micActivated', 'micMuted', 'micStarting', 'cameraOn', 'sharing', 'speaking'] as const satisfies readonly (keyof Participant)[];
const MEDIA = new Set<string>(MEDIA_FIELDS);

/** A participant as the roster gives it: who they are and which call they are in, without the media flags. */
export type RosterParticipant = Omit<Participant, (typeof MEDIA_FIELDS)[number]>;

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // each server update brings new arrays (profileLinks), equal or not
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
}

function sameIgnoringMedia(a: Participant, b: Participant): boolean {
  if (a === b) return true;
  const keys = Object.keys(a).filter((key) => !MEDIA.has(key)) as (keyof Participant)[];
  if (keys.length !== Object.keys(b).filter((key) => !MEDIA.has(key)).length) return false;
  return keys.every((key) => sameValue(a[key], b[key]));
}

export function sameRoster(a: ReadonlyMap<string, Participant>, b: ReadonlyMap<string, Participant>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, participant] of a) {
    const other = b.get(id);
    if (!other || !sameIgnoringMedia(participant, other)) return false;
  }
  return true;
}

const selectParticipants = (room: RoomContextValue) => room.state.participants;

/**
 * The other connections the account can see, keyed by participant id, for
 * anything that needs who is in which call but not what their mic or camera
 * is doing. It keeps the same identity through media changes, so the sidebar,
 * the rail or a chat card does not re-render each time someone starts or stops
 * speaking. Call UI that shows media reads `participants` from `useRoomState`.
 */
export function useCallRoster(): ReadonlyMap<string, RosterParticipant> {
  return useRoomSelector(selectParticipants, sameRoster);
}

/** The same, for RoomProvider itself, which sits above the store: `participants` keeps its
 * identity through media changes, so what the provider derives from it does too. */
export function useStableRoster(participants: Map<string, Participant>): ReadonlyMap<string, RosterParticipant> {
  const [stable, setStable] = useState(participants);
  const same = sameRoster(stable, participants);
  if (stable !== participants && !same) setStable(participants);
  return same ? stable : participants;
}
