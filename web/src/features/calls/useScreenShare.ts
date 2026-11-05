import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadShareQuality } from '../settings/useShareQualityPreference';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import { i18n } from '@/shared/i18n/init';

interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  /** Restart capture through the native picker so source and quality changes take effect. */
  changeSource: () => Promise<void>;
  /** Muting keeps the share tile visible with a paused-preview state; stopping removes it. */
  pauseSharePreview: () => Promise<void>;
  resumeSharePreview: () => Promise<void>;
}

// Capturing the whole display also captures what this tab plays — the other
// participants' voices — and publishing it sends them their own audio back.
// `restrictOwnAudio` is the only way to filter it out, and browsers that
// don't implement it silently ignore the constraint, so the resulting track
// has to be checked rather than trusted.
async function dropAudioThatLoopsBack(room: Room): Promise<boolean> {
  const { localParticipant } = room;
  const surface = localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.mediaStreamTrack.getSettings().displaySurface;
  const audioTrack = localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
  if (surface !== 'monitor' || !audioTrack) return false;
  const { restrictOwnAudio } = audioTrack.mediaStreamTrack.getSettings() as { restrictOwnAudio?: boolean };
  if (restrictOwnAudio === true) return false;
  await localParticipant.unpublishTrack(audioTrack, true);
  return true;
}

export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const startSharing = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.videoConnecting') });
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

    const audioConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      restrictOwnAudio: true,
    };

    const quality = SHARE_QUALITY_PRESETS[loadShareQuality()];

    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: audioConstraints,
          resolution: quality.resolution,
          contentHint: quality.contentHint,
          selfBrowserSurface: 'exclude',
        },
        {
          // `videoEncoding` is the camera field; screen share only honors
          // `screenShareEncoding`. One layer: a simulcast half-res layer is
          // what a game tile would actually subscribe to.
          screenShareEncoding: quality.encoding,
          degradationPreference: quality.degradationPreference,
          simulcast: false,
        },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const aborted = name === 'NotAllowedError' || name === 'AbortError';
      if (!aborted) dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenCapture', { error: (err as Error)?.message }) });
      return;
    }

    if (await dropAudioThatLoopsBack(room)) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.screenLoopback') });
    } else {
      dispatch({ type: 'SET_SHARE_ERROR', message: null });
    }
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
  }, [dispatch, room]);

  const stopSharing = useCallback(() => {
    room.localParticipant.setScreenShareEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
  }, [dispatch, room]);

  const changeSource = useCallback(async () => {
    stopSharing();
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
