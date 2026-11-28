import { useEffect, useRef } from 'react';
import { useRoom, useRoomSelector, useRoomState } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack, useScreenShareSubscriptions } from './useLiveKitTrack';
import { loadCallVolume } from '../settings/useCallVolumePreference';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { useAudioPreferences } from './audioPreferences';
import { getParticipantVolume, setParticipantVolume } from './participantVolume';
import { usePreferenceValue } from '@/shared/preferences/accountPreferences';

function ParticipantAudio({ participantId }: { participantId: string }) {
  const { audioRegistry, audioUnlocked, deafened } = useRoom('audioRegistry', 'audioUnlocked', 'deafened');
  const userId = useRoomSelector((room) => room.state.participants.get(participantId)?.userId ?? null);
  const media = useParticipantMedia(participantId);
  const { outputVolume } = useAudioPreferences();
  const micRef = useRef<HTMLAudioElement | null>(null);
  const screenRef = useRef<HTMLAudioElement | null>(null);
  useAttachTrack(media.micTrack, micRef);
  useAttachTrack(media.screenAudioTrack, screenRef);

  useEffect(() => {
    for (const el of [micRef.current, screenRef.current]) {
      if (!el) continue;
      el.muted = !audioUnlocked || deafened;
      if (audioUnlocked && !deafened) el.play().catch(() => {});
    }
  }, [audioUnlocked, deafened, media.micTrack, media.screenAudioTrack]);

  useEffect(() => {
    const registry = audioRegistry.current;
    const screenKey = `${participantId}:screen`;
    const micEl = micRef.current;
    const screenEl = screenRef.current;
    // Apply the saved output to newly created audio elements when supported.
    const savedOutputId = loadDevicePreference('audiooutput');
    if (savedOutputId) {
      for (const el of [micEl, screenEl]) {
        if (el && 'setSinkId' in el) el.setSinkId(savedOutputId).catch(() => {});
      }
    }
    if (micEl) {
      setParticipantVolume(micEl, userId ? loadCallVolume(userId) : 1);
      registry.set(participantId, { element: micEl });
    }
    // Register screen audio only when a track exists so a missing share is not
    // exposed as a mutable audio control in the tile menu.
    if (screenEl && media.screenAudioTrack) {
      setParticipantVolume(screenEl, userId ? loadCallVolume(`${userId}:screen`) : 1);
      registry.set(screenKey, { element: screenEl });
    } else {
      registry.delete(screenKey);
    }
    return () => {
      registry.delete(participantId);
      registry.delete(screenKey);
    };
  }, [participantId, userId, audioRegistry, media.screenAudioTrack]);

  // a volume given to this person on another device (or in another tab) applies at once
  const micVolume = usePreferenceValue(() => (userId ? loadCallVolume(userId) : 1));
  const screenVolume = usePreferenceValue(() => (userId ? loadCallVolume(`${userId}:screen`) : 1));
  useEffect(() => {
    if (micRef.current) setParticipantVolume(micRef.current, micVolume);
    if (screenRef.current) setParticipantVolume(screenRef.current, screenVolume);
  }, [micVolume, screenVolume]);

  useEffect(() => {
    for (const el of [micRef.current, screenRef.current]) {
      if (el) setParticipantVolume(el, getParticipantVolume(el), outputVolume);
    }
  }, [outputVolume]);

  return (
    <>
      <audio ref={micRef} autoPlay muted={!audioUnlocked || deafened} />
      <audio ref={screenRef} autoPlay muted={!audioUnlocked || deafened} />
    </>
  );
}

export function ParticipantAudioLayer({ participantIds }: { participantIds: string[] }) {
  const { livekitRoom } = useRoom('livekitRoom');
  const state = useRoomState('me', 'unwatchedScreenKeys');
  useScreenShareSubscriptions(livekitRoom, state.unwatchedScreenKeys);
  return (
    <>
      {participantIds
        .filter((id) => id !== state.me.id)
        .map((id) => <ParticipantAudio key={id} participantId={id} />)}
    </>
  );
}
