import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, LocalAudioTrack, LocalVideoTrack, Track } from 'livekit-client';
import type { LocalTrack, Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadShareQuality } from '../settings/useShareQualityPreference';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import { screenSharePublishOptions } from './videoPublish';
import { i18n } from '@/shared/i18n/init';
import { mayPublish } from './publishRights';
import { audioCarriesTheCall, displayCaptureOptions } from './displayCapture';

interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  /** Restart capture through the native picker so source and quality changes take effect. */
  changeSource: () => Promise<void>;
  /** Muting keeps the share tile visible with a paused-preview state; stopping removes it. */
  pauseSharePreview: () => Promise<void>;
  resumeSharePreview: () => Promise<void>;
}

async function captureAndPublish(room: Room, dispatch: Dispatch<RoomAction>): Promise<void> {
  const qualityId = loadShareQuality();
  const reportFailure = (err: unknown) => {
    dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenCapture', { error: (err as Error)?.message }) });
  };

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(displayCaptureOptions(qualityId));
  } catch (err) {
    const name = (err as DOMException)?.name;
    if (name !== 'NotAllowedError' && name !== 'AbortError') reportFailure(err);
    return;
  }

  const [video] = stream.getVideoTracks();
  if (!video) {
    stream.getTracks().forEach((t) => t.stop());
    reportFailure(new Error('no video track'));
    return;
  }
  const captured: MediaStreamTrack | undefined = stream.getAudioTracks()[0];
  // Checked before publishing so the call never goes out, not even for the
  // moment it would take to unpublish it.
  const droppedAudio = captured !== undefined && audioCarriesTheCall(video, captured);
  if (droppedAudio) captured.stop();
  const audio = droppedAudio ? undefined : captured;

  const screenVideo = new LocalVideoTrack(video, undefined, false);
  screenVideo.source = Track.Source.ScreenShare;
  video.contentHint = SHARE_QUALITY_PRESETS[qualityId].contentHint;
  const tracks: LocalTrack[] = [screenVideo];
  if (audio) {
    const screenAudio = new LocalAudioTrack(audio, undefined, false);
    screenAudio.source = Track.Source.ScreenShareAudio;
    tracks.push(screenAudio);
  }

  const publishOptions = screenSharePublishOptions(qualityId);
  try {
    await Promise.all(tracks.map((track) => room.localParticipant.publishTrack(track, publishOptions)));
  } catch (err) {
    await Promise.allSettled(tracks.map((track) => room.localParticipant.unpublishTrack(track, true)));
    tracks.forEach((track) => track.stop());
    reportFailure(err);
    return;
  }

  dispatch({ type: 'SET_SHARE_ERROR', message: droppedAudio ? i18n.t('calls:errors.screenLoopback') : null });
  dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
}

export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const capturing = useRef(false);

  const startSharing = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.videoConnecting') });
      return;
    }
    if (!mayPublish(room.localParticipant.permissions, Track.Source.ScreenShare)) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.noStreamPermission') });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenUnsupported') });
      return;
    }
    if (!window.isSecureContext) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.httpsRequired') });
      return;
    }
    if (capturing.current) return;
    capturing.current = true;
    try {
      await captureAndPublish(room, dispatch);
    } finally {
      capturing.current = false;
    }
  }, [dispatch, room]);

  const stopSharing = useCallback(async (): Promise<boolean> => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      return true;
    }
    try {
      await room.localParticipant.setScreenShareEnabled(false);
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenStop', { error: (err as Error)?.message }) });
      return false;
    }
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
    return true;
  }, [dispatch, room]);

  const changeSource = useCallback(async () => {
    if (!await stopSharing()) return;
    await startSharing();
  }, [stopSharing, startSharing]);

  const pauseSharePreview = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (!pub) return;
    try {
      await pub.mute();
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.pausePreview', { error: (err as Error)?.message }) });
    }
  }, [room, dispatch]);

  const resumeSharePreview = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);
    if (!pub) return;
    try {
      await pub.unmute();
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.resumePreview', { error: (err as Error)?.message }) });
    }
  }, [room, dispatch]);

  return { startSharing, stopSharing, changeSource, pauseSharePreview, resumeSharePreview };
}
