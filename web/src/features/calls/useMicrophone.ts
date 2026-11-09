import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { LocalAudioTrack, Room } from 'livekit-client';
import type { MicProblem, RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { i18n } from '@/shared/i18n/init';
import { logger } from '@/shared/lib/logger';
import { getAudioPreferences } from './audioPreferences';
import { applyInputGain } from './inputGain';
import { captureOptionsForProfile } from './inputProfile';
import { mayPublish } from './publishRights';

const log = logger.child({ component: 'microphone' });

interface MicrophoneApi {
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  setMicMuted: (muted: boolean) => Promise<void>;
  leaveMic: () => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15000;

function waitForConnection(room: Room): Promise<void> {
  if (room.state === ConnectionState.Connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, CONNECT_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, onConnected);
    }
    function onConnected() { cleanup(); resolve(); }
    room.once(RoomEvent.Connected, onConnected);
  });
}

export function useMicrophone(room: Room, dispatch: Dispatch<RoomAction>): MicrophoneApi {
  const activatingRef = useRef(false);
  const micProblemRef = useRef<MicProblem>(null);
  const setMicProblem = useCallback((problem: MicProblem) => {
    micProblemRef.current = problem;
    dispatch({ type: 'SET_MIC_PROBLEM', problem });
  }, [dispatch]);

  const activateMic = useCallback(async () => {
    if (activatingRef.current) return;
    if (room.localParticipant.getTrackPublication(Track.Source.Microphone)) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.microphoneUnsupported') });
      return;
    }

    activatingRef.current = true;
    try {
      await waitForConnection(room);
      // a channel without SPEAK: the SFU would refuse the track, and the call
      // join (which calls this on its own) must not read that as a broken mic
      if (!mayPublish(room.localParticipant.permissions, Track.Source.Microphone)) return;
      // Without this, a freshly created track always starts on whatever
      // device the browser picks by default — the device saved in Settings
      // (useMediaDevices#selectDevice) only ever got applied to an ALREADY
      // active track via room.switchActiveDevice, called from within the
      // Settings modal itself. Activating the mic without opening Settings
      // first (the common case — a call's mic button) never consulted it,
      // so the choice looked like it "didn't stick".
      const savedDeviceId = loadDevicePreference('audioinput');
      const { inputProfile, inputVolume } = getAudioPreferences();
      const options = { ...(savedDeviceId ? { deviceId: savedDeviceId } : {}), ...captureOptionsForProfile(inputProfile) };
      await room.localParticipant.setMicrophoneEnabled(true, Object.keys(options).length > 0 ? options : undefined);
      setMicProblem(null);
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
      if (track) {
        applyInputGain(track, inputVolume).catch((err) => log.warn('Failed to apply the input volume', { err: String(err) }));
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.videoConnectionFailed') });
        return;
      }
      const name = (err as DOMException)?.name;
      // Unlike camera/screen share, this runs automatically on every call
      // join, so staying silent here reads as "the call is broken". These
      // become persistent state rather than a dismissable error: permission
      // may already be granted with the mic simply unplugged, and the UI has
      // to keep saying so until one shows up.
      if (name === 'NotFoundError') { setMicProblem('not-found'); return; }
      if (name === 'NotAllowedError') { setMicProblem('denied'); return; }
      if (name === 'NotReadableError' || name === 'AbortError') { setMicProblem('unavailable'); return; }
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.microphoneAccess', { error: (err as Error)?.message }) });
    } finally {
      activatingRef.current = false;
    }
  }, [dispatch, room, setMicProblem]);

  // Plugging a mic in (or another one appearing) mid-call publishes it
  // without the user having to find the retry button. A denied permission is
  // left alone: no device change can lift it.
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const onDeviceChange = () => {
      if (micProblemRef.current === 'denied' || !micProblemRef.current || room.state !== ConnectionState.Connected) return;
      void activateMic();
    };
    mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [activateMic, room]);

  const toggleMicMuted = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub) return;
    const wasMuted = pub.isMuted;
    await room.localParticipant.setMicrophoneEnabled(wasMuted);
    playSound(wasMuted ? 'unmuted' : 'muted');
  }, [room]);

  const setMicMuted = useCallback(async (muted: boolean) => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub) return;
    await room.localParticipant.setMicrophoneEnabled(!muted);
  }, [room]);

  const leaveMic = useCallback(async () => {
    setMicProblem(null);
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track as LocalAudioTrack | undefined;
    if (!track) return;
    await room.localParticipant.unpublishTrack(track, true);
  }, [room, setMicProblem]);

  return { activateMic, toggleMicMuted, setMicMuted, leaveMic };
}
