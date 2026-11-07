import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useCamera } from '@/features/calls/useCamera';
import { saveDevicePreference } from '@/features/settings/useDevicePreference';
import { cameraCaptureOptions, cameraPublishOptions, CAMERA_CONTENT_HINT } from '@/features/calls/videoPublish';

function fakeRoom(setCameraEnabled: (...args: never[]) => Promise<unknown> = vi.fn(async () => undefined)) {
  return {
    state: ConnectionState.Connected,
    localParticipant: { setCameraEnabled },
  } as unknown as Room;
}

describe('useCamera — startCamera applies the saved camera', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('passes the deviceId saved in Settings to setCameraEnabled, keeping the resolution', async () => {
    saveDevicePreference('videoinput', 'preferred-camera');
    const setCameraEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setCameraEnabled);
    const { result } = renderHook(() => useCamera(room, vi.fn()));

    await result.current.startCamera();

    expect(setCameraEnabled).toHaveBeenCalledWith(true, cameraCaptureOptions('preferred-camera'), cameraPublishOptions());
  });

  it('without a saved preference, does not include deviceId in the capture options', async () => {
    const setCameraEnabled = vi.fn(async () => undefined);
    const room = fakeRoom(setCameraEnabled);
    const { result } = renderHook(() => useCamera(room, vi.fn()));

    await result.current.startCamera();

    expect(setCameraEnabled).toHaveBeenCalledWith(true, cameraCaptureOptions(null), cameraPublishOptions());
  });

  it('sets the detail content hint on the track the publication returns', async () => {
    const mediaStreamTrack = { contentHint: '' };
    const setCameraEnabled = vi.fn(async () => ({ track: { mediaStreamTrack } }));
    const room = fakeRoom(setCameraEnabled);
    const { result } = renderHook(() => useCamera(room, vi.fn()));

    await result.current.startCamera();

    expect(mediaStreamTrack.contentHint).toBe(CAMERA_CONTENT_HINT);
  });

  it('does not mark the camera off when LiveKit refuses to mute it', async () => {
    const dispatch = vi.fn();
    const setCameraEnabled = vi.fn(async (enabled: boolean) => {
      if (!enabled) throw new Error('still starting');
    });
    const room = fakeRoom(setCameraEnabled as never);
    const { result } = renderHook(() => useCamera(room, dispatch));

    await result.current.stopCamera();

    expect(setCameraEnabled).toHaveBeenCalledWith(false);
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_LOCAL_CAMERA', on: false });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('desligar') });
  });
});
