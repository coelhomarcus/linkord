import { useCallback } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { applyCameraContentHint, cameraCaptureOptions, cameraPublishOptions } from './videoPublish';
import { i18n } from '@/shared/i18n/init';

interface CameraApi {
  startCamera: () => Promise<void>;
  stopCamera: () => void;
}

export function useCamera(room: Room, dispatch: Dispatch<RoomAction>): CameraApi {
  const startCamera = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.videoConnecting') });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.cameraUnsupported') });
      return;
    }

    try {
      // Same reasoning as activateMic (useMicrophone.ts) — a fresh track
      // otherwise starts on whatever device the browser defaults to,
      // ignoring the one saved in Settings.
      const savedDeviceId = loadDevicePreference('videoinput');
      const publication = await room.localParticipant.setCameraEnabled(
        true,
        cameraCaptureOptions(savedDeviceId),
        cameraPublishOptions(),
      );
      applyCameraContentHint(publication?.track?.mediaStreamTrack);
    } catch (err) {
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.cameraAccess', { error: (err as Error)?.message }) });
      return;
    }

    dispatch({ type: 'SET_LOCAL_CAMERA', on: true });
  }, [dispatch, room]);

  const stopCamera = useCallback(() => {
    room.localParticipant.setCameraEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
  }, [dispatch, room]);

  return { startCamera, stopCamera };
}
