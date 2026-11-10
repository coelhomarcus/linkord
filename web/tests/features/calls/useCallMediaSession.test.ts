import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCallMediaSession } from '@/features/calls/useCallMediaSession';

class FakeMediaMetadata {
  title: string;
  artist: string;
  constructor(init: { title: string; artist: string }) {
    this.title = init.title;
    this.artist = init.artist;
  }
}

function fakeSession() {
  const handlers = new Map<string, (() => void) | null>();
  return {
    metadata: null as FakeMediaMetadata | null,
    playbackState: 'none',
    handlers,
    setActionHandler: vi.fn((action: string, handler: (() => void) | null) => { handlers.set(action, handler); }),
    setMicrophoneActive: vi.fn(),
  };
}

let session: ReturnType<typeof fakeSession>;

beforeEach(() => {
  session = fakeSession();
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  vi.stubGlobal('MediaMetadata', FakeMediaMetadata);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaSession');
  vi.unstubAllGlobals();
});

const base: Parameters<typeof useCallMediaSession>[0] = { inCall: true, title: 'geral', micMuted: false, toggleMic: () => {}, hangUp: () => {} };

describe('useCallMediaSession', () => {
  it('names the call and marks it playing while in a call', () => {
    renderHook(() => useCallMediaSession(base));
    expect(session.metadata).toMatchObject({ title: 'geral', artist: 'Linkord' });
    expect(session.playbackState).toBe('playing');
  });

  it('touches nothing outside a call', () => {
    renderHook(() => useCallMediaSession({ ...base, inCall: false }));
    expect(session.metadata).toBeNull();
    expect(session.setActionHandler).not.toHaveBeenCalled();
  });

  it('wires hang up and mute to the latest callbacks', () => {
    const hangUp = vi.fn();
    const toggleMic = vi.fn();
    const { rerender } = renderHook((props) => useCallMediaSession(props), { initialProps: base });
    rerender({ ...base, hangUp, toggleMic });

    session.handlers.get('hangup')?.();
    session.handlers.get('togglemicrophone')?.();
    expect(hangUp).toHaveBeenCalledOnce();
    expect(toggleMic).toHaveBeenCalledOnce();
  });

  it('reports the mic state and offers no mute without a mic', () => {
    const { rerender } = renderHook((props) => useCallMediaSession(props), { initialProps: base });
    expect(session.setMicrophoneActive).toHaveBeenLastCalledWith(true);
    rerender({ ...base, micMuted: true });
    expect(session.setMicrophoneActive).toHaveBeenLastCalledWith(false);
    rerender({ ...base, micMuted: null });
    expect(session.handlers.get('togglemicrophone')).toBeNull();
  });

  it('clears everything when the call ends', () => {
    const { rerender } = renderHook((props) => useCallMediaSession(props), { initialProps: base });
    rerender({ ...base, inCall: false });
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    expect(session.handlers.get('hangup')).toBeNull();
  });

  it('keeps going when the browser rejects the conference actions', () => {
    session.setActionHandler.mockImplementation(() => { throw new TypeError('unsupported action'); });
    expect(() => renderHook(() => useCallMediaSession(base))).not.toThrow();
  });
});
