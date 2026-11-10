import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ConnectionState, Track } from 'livekit-client';
import type { LocalTrack, Room } from 'livekit-client';
import { useScreenShare } from '@/features/calls/useScreenShare';
import { saveShareQuality } from '@/features/settings/useShareQualityPreference';
import { SHARE_QUALITY_PRESETS } from '@/features/calls/shareQualityPresets';

function fakeTrack(kind: 'video' | 'audio', settings: Record<string, unknown> = {}) {
  return {
    kind,
    id: `${kind}-track`,
    label: kind,
    enabled: true,
    muted: false,
    readyState: 'live',
    contentHint: '',
    getSettings: () => settings,
    getConstraints: () => ({}),
    getCapabilities: () => ({}),
    applyConstraints: vi.fn(async () => undefined),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    clone() { return this; },
    stop: vi.fn(),
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}

function fakeStream(video: MediaStreamTrack | null, audio: MediaStreamTrack | null = null) {
  const tracks = [video, audio].filter((t): t is MediaStreamTrack => t !== null);
  return {
    getVideoTracks: () => (video ? [video] : []),
    getAudioTracks: () => (audio ? [audio] : []),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

function stubDisplayMedia(stream: MediaStream | (() => Promise<MediaStream>)) {
  const getDisplayMedia = vi.fn(typeof stream === 'function' ? stream : async () => stream);
  Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });
  return getDisplayMedia;
}

function fakeRoom(overrides: {
  publishTrack?: ReturnType<typeof vi.fn>;
  setScreenShareEnabled?: ReturnType<typeof vi.fn>;
  getTrackPublication?: ReturnType<typeof vi.fn>;
} = {}) {
  const publishTrack = overrides.publishTrack ?? vi.fn(async () => ({}));
  const unpublishTrack = vi.fn(async () => undefined);
  const room = {
    state: ConnectionState.Connected,
    localParticipant: {
      publishTrack,
      unpublishTrack,
      setScreenShareEnabled: overrides.setScreenShareEnabled ?? vi.fn(async () => undefined),
      getTrackPublication: overrides.getTrackPublication ?? vi.fn(() => undefined),
    },
  } as unknown as Room;
  return { room, publishTrack, unpublishTrack };
}

function publishedTracks(publishTrack: ReturnType<typeof vi.fn>): LocalTrack[] {
  return publishTrack.mock.calls.map(([track]) => track as LocalTrack);
}

// jsdom has no MediaStream; livekit-client wraps each track in one.
class FakeMediaStream {
  private tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) { this.tracks = [...tracks]; }
  getTracks() { return this.tracks; }
  addTrack(track: MediaStreamTrack) { this.tracks.push(track); }
  removeTrack(track: MediaStreamTrack) { this.tracks = this.tracks.filter((t) => t !== track); }
}

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

function useUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeMediaStream);
  useUserAgent(CHROME_UA);
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useScreenShare — quality applied to the capture', () => {
  it('without a saved preference, captures and publishes with the 1080p60 preset', async () => {
    const video = fakeTrack('video', { displaySurface: 'window' });
    const getDisplayMedia = stubDisplayMedia(fakeStream(video));
    const { room, publishTrack } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    const preset = SHARE_QUALITY_PRESETS.game1080;
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: { width: { ideal: preset.resolution.width }, height: { ideal: preset.resolution.height }, frameRate: preset.resolution.frameRate },
    }));
    expect(video.contentHint).toBe(preset.contentHint);
    expect(publishTrack).toHaveBeenCalledWith(expect.anything(), {
      screenShareEncoding: preset.encoding,
      degradationPreference: preset.degradationPreference,
      simulcast: false,
    });
    expect(publishedTracks(publishTrack).map((t) => t.source)).toEqual([Track.Source.ScreenShare]);
  });

  it('with a saved quality preference, the next capture uses the chosen preset', async () => {
    saveShareQuality('screen1080');
    const getDisplayMedia = stubDisplayMedia(fakeStream(fakeTrack('video')));
    const { room, publishTrack } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    const preset = SHARE_QUALITY_PRESETS.screen1080;
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: expect.objectContaining({ frameRate: preset.resolution.frameRate, width: { ideal: preset.resolution.width } }),
    }));
    expect(publishTrack).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ screenShareEncoding: preset.encoding }));
  });

  it('reads a choice saved under the old two-preset ids', async () => {
    localStorage.setItem('ss-share-quality', 'game');
    const getDisplayMedia = stubDisplayMedia(fakeStream(fakeTrack('video')));
    const { room } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: expect.objectContaining({ width: { ideal: SHARE_QUALITY_PRESETS.game1440.resolution.width } }),
    }));
  });

  it('on Safari, caps the size instead of hinting it, as Safari captures the full display otherwise', async () => {
    useUserAgent(SAFARI_UA);
    const getDisplayMedia = stubDisplayMedia(fakeStream(fakeTrack('video')));
    const { room } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    const { width, height, frameRate } = SHARE_QUALITY_PRESETS.game1080.resolution;
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      video: { width: { max: width }, height: { max: height }, frameRate },
    }));
  });

  it('asks for the window\'s own audio and for system audio without this tab, and hides this tab', async () => {
    const getDisplayMedia = stubDisplayMedia(fakeStream(fakeTrack('video')));
    const { room } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.startSharing();

    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: expect.objectContaining({ restrictOwnAudio: true, echoCancellation: false }),
      windowAudio: 'window',
      selfBrowserSurface: 'exclude',
    }));
  });
});

describe('useScreenShare — starting', () => {
  it('cancelling the picker reports nothing and does not mark the share as started', async () => {
    stubDisplayMedia(async () => { throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }); });
    const { room, publishTrack } = fakeRoom();
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.startSharing();

    expect(publishTrack).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('a failed publish stops the capture and reports the error', async () => {
    const video = fakeTrack('video', { displaySurface: 'browser' });
    const audio = fakeTrack('audio');
    stubDisplayMedia(fakeStream(video, audio));
    const { room, unpublishTrack } = fakeRoom({ publishTrack: vi.fn(async () => { throw new Error('signal lost'); }) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.startSharing();

    expect(unpublishTrack).toHaveBeenCalledTimes(2);
    expect(video.stop).toHaveBeenCalled();
    expect(audio.stop).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('signal lost') }));
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: true });
  });

  it('a second start while the picker is open does not open another one', async () => {
    let resolve!: (stream: MediaStream) => void;
    const getDisplayMedia = stubDisplayMedia(() => new Promise<MediaStream>((r) => { resolve = r; }));
    const { room } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    const first = result.current.startSharing();
    await result.current.startSharing();
    resolve(fakeStream(fakeTrack('video')));
    await first;

    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });
});

describe('useScreenShare — changing source', () => {
  it('stops the current capture and reopens a new picker (ends, then starts again)', async () => {
    const getDisplayMedia = stubDisplayMedia(fakeStream(fakeTrack('video')));
    const { room } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.changeSource();

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    expect(getDisplayMedia).toHaveBeenCalledTimes(1);
  });

  it('cancelling the picker while changing source does not leave "sharing" stuck at true', async () => {
    stubDisplayMedia(async () => { throw Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }); });
    const dispatch = vi.fn();
    const { room } = fakeRoom();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.changeSource();

    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: false });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: true });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('capturar') }));
  });
});

describe('useScreenShare — pause/resume own preview', () => {
  it('pausing calls mute() on the existing publication, without ending the share', async () => {
    const mute = vi.fn(async () => undefined);
    const { room } = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute, unmute: vi.fn() })) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.pauseSharePreview();

    expect(mute).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_LOCAL_SHARING' }));
  });

  it('resuming calls unmute() on the existing publication', async () => {
    const unmute = vi.fn(async () => undefined);
    const { room } = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute: vi.fn(), unmute })) });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await result.current.resumeSharePreview();

    expect(unmute).toHaveBeenCalled();
  });

  it('without a screen publication (not sharing), pause/resume do nothing and do not break', async () => {
    const { room } = fakeRoom({ getTrackPublication: vi.fn(() => undefined) });
    const { result } = renderHook(() => useScreenShare(room, vi.fn()));

    await expect(result.current.pauseSharePreview()).resolves.toBeUndefined();
    await expect(result.current.resumeSharePreview()).resolves.toBeUndefined();
  });

  it('failing to pause reports the error, without leaving the state stuck', async () => {
    const mute = vi.fn(async () => { throw new Error('boom'); });
    const { room } = fakeRoom({ getTrackPublication: vi.fn(() => ({ mute, unmute: vi.fn() })) });
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));

    await result.current.pauseSharePreview();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('pausar') }));
  });
});

describe('useScreenShare — the call\'s audio never reaches the share', () => {
  async function share(displaySurface: string, audioSettings: Record<string, unknown>) {
    const audio = fakeTrack('audio', audioSettings);
    stubDisplayMedia(fakeStream(fakeTrack('video', { displaySurface }), audio));
    const { room, publishTrack } = fakeRoom();
    const dispatch = vi.fn();
    const { result } = renderHook(() => useScreenShare(room, dispatch));
    await result.current.startSharing();
    return { audio, dispatch, sources: publishedTracks(publishTrack).map((t) => t.source) };
  }

  it('drops a window\'s audio before publishing when the browser could not keep this tab out (Windows 10)', async () => {
    const { audio, dispatch, sources } = await share('window', { restrictOwnAudio: false });

    expect(sources).toEqual([Track.Source.ScreenShare]);
    expect(audio.stop).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOCAL_SHARING', sharing: true });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_SHARE_ERROR', message: expect.stringContaining('sem áudio') }));
  });

  it('drops a whole screen\'s audio when the browser does not report the exclusion at all', async () => {
    const { sources } = await share('monitor', {});

    expect(sources).toEqual([Track.Source.ScreenShare]);
  });

  it('publishes a window\'s or screen\'s audio when the browser confirms it left this tab out', async () => {
    for (const surface of ['window', 'monitor']) {
      const { audio, dispatch, sources } = await share(surface, { restrictOwnAudio: true });

      expect(sources).toEqual([Track.Source.ScreenShare, Track.Source.ScreenShareAudio]);
      expect(audio.stop).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledWith({ type: 'SET_SHARE_ERROR', message: null });
    }
  });

  it('publishes a tab\'s audio, which is that tab alone', async () => {
    const { sources } = await share('browser', {});

    expect(sources).toEqual([Track.Source.ScreenShare, Track.Source.ScreenShareAudio]);
  });
});
