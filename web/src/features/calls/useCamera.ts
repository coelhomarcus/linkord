import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadDevicePreference } from '../settings/useDevicePreference';
import { applyCameraContentHint, cameraCaptureOptions, cameraPublishOptions } from './videoPublish';
import { i18n } from '@/shared/i18n/init';

interface CameraApi {
  startCamera: () => Promise<void>;
  stopCamera: () => Promise<void>;
}

export function useCamera(room: Room, dispatch: Dispatch<RoomAction>): CameraApi {
  // Turns overlap when the button is clicked again before LiveKit settles.
  // A later turn must not be undone by the earlier one finishing last.
  const tail = useRef(Promise.resolve());
  const run = useCallback((task: () => Promise<void>) => {
    const next = tail.current.then(task, task);
    tail.current = next.then(() => undefined, () => undefined);
    return next;
  }, []);

  const startCamera = useCallback(() => run(async () => {
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
  }), [dispatch, room, run]);

  const stopCamera = useCallback(() => run(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
      return;
    }
    try {
      await room.localParticipant.setCameraEnabled(false);
    } catch (err) {
      dispatch({ type: 'SET_SHARE_ERROR', message: i18n.t('calls:errors.cameraStop', { error: (err as Error)?.message }) });
      return;
    }
    dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
  }), [dispatch, room, run]);

  return { startCamera, stopCamera };
}
