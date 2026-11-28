import { vi } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';

export function fakePublication(source: Track.Source, sid: string, options: { name?: string; track?: object; muted?: boolean } = {}) {
  const publication = {
    source,
    trackSid: sid,
    trackName: options.name ?? '',
    track: options.track,
    isMuted: options.muted ?? false,
    isDesired: false,
    setSubscribed: vi.fn((desired: boolean) => { publication.isDesired = desired; }),
  };
  return publication;
}

type Publication = ReturnType<typeof fakePublication>;

function fakeParticipant(identity: string) {
  const publications = new Map<Track.Source, Publication>();
  return { identity, publications, getTrackPublication: (source: Track.Source) => publications.get(source) };
}

export function fakeCallMediaRoom() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const remoteParticipants = new Map<string, ReturnType<typeof fakeParticipant>>();
  const localParticipant = fakeParticipant('p-me');
  function emit(event: RoomEvent, ...args: unknown[]) {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  }
  const raw = {
    localParticipant,
    remoteParticipants,
    getParticipantByIdentity: (id: string) => id === localParticipant.identity ? localParticipant : remoteParticipants.get(id),
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
  };
  function addRemote(id: string) {
    const participant = fakeParticipant(id);
    remoteParticipants.set(id, participant);
    return participant;
  }
  function publish(participant: ReturnType<typeof fakeParticipant>, publication: Publication) {
    participant.publications.set(publication.source, publication);
    emit(RoomEvent.TrackPublished, publication, participant);
  }
  function unpublish(participant: ReturnType<typeof fakeParticipant>, publication: Publication) {
    participant.publications.delete(publication.source);
    emit(RoomEvent.TrackUnpublished, publication, participant);
  }
  return { room: raw as unknown as Room, localParticipant, addRemote, publish, unpublish, emit };
}
