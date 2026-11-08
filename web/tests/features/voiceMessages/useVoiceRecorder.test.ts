import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MIN_TAKE_MS, useVoiceRecorder, type RecorderEnv, type VoiceTake } from '@/features/voiceMessages/useVoiceRecorder';
import { MAX_VOICE_DURATION_MS, decodeWaveform } from '@/features/voiceMessages/voiceFormat';
import { FakeRecorder, fakeRecorderEnv } from '@tests/fixtures/fakeRecorderEnv';

function setup(overrides: Partial<RecorderEnv> = {}) {
  const fake = fakeRecorderEnv(overrides);
  const takes: { take: VoiceTake; conversationId: string }[] = [];
  const hook = renderHook(() => useVoiceRecorder({ env: fake.env, onTake: (take, conversationId) => takes.push({ take, conversationId }) }));
  const elapse = (ms: number) => act(() => { fake.advance(ms); vi.advanceTimersByTime(ms); });
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return { ...hook, ...fake, takes, elapse, settle };
}

function domError(name: string) {
  return new DOMException('refused', name);
}

describe('useVoiceRecorder', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('goes idle → requesting → recording, and asks for the mic only once started', async () => {
    const { result, getUserMedia, settle } = setup();
    expect(result.current.view.phase).toBe('idle');
    expect(getUserMedia).not.toHaveBeenCalled();

    let started!: Promise<void>;
    act(() => { started = result.current.start('conv-1', 'locked'); });
    expect(result.current.view.phase).toBe('requesting');
    await act(async () => { await started; });
    await settle();
    expect(result.current.view.phase).toBe('recording');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: expect.objectContaining({ echoCancellation: true }) });
  });

  it('stop hands over the take with its conversation, duration and waveform, and releases the mic', async () => {
    const { result, track, takes, elapse, settle } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(3_000);
    expect(result.current.view.elapsedMs).toBe(3_000);

    act(() => result.current.stop());
    await settle();

    expect(takes).toHaveLength(1);
    expect(takes[0]!.conversationId).toBe('conv-1');
    expect(takes[0]!.take).toMatchObject({ durationMs: 3_000, url: 'blob:voice-take' });
    expect(takes[0]!.take.file.type).toBe('audio/webm');
    expect(decodeWaveform(takes[0]!.take.waveform).length).toBeGreaterThan(0);
    expect(track.stopped).toBe(true);
    expect(result.current.view.phase).toBe('idle');
  });

  it('records in the first format the browser supports', async () => {
    const { result, recorders } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    expect(recorders[0]!.mimeType).toBe('audio/webm;codecs=opus');
  });

  it('a format the browser claims but cannot encode falls back to the next one on the same stream', async () => {
    // a Chromium without the AAC encoder: MP4 "is supported", then fails with EncodingError
    class BrokenMp4 extends FakeRecorder {
      override start() {
        this.state = 'recording';
        queueMicrotask(() => {
          this.state = 'inactive';
          this.dispatchEvent(Object.assign(new Event('error'), { error: new DOMException('no encoder', 'EncodingError') }));
          this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([]) }));
          this.dispatchEvent(new Event('stop'));
        });
      }
    }
    const created: FakeRecorder[] = [];
    const { result, takes, elapse, settle, getUserMedia } = setup({
      isTypeSupported: () => true,
      createRecorder: (_stream, mimeType) => {
        const recorder = mimeType.startsWith('audio/mp4') ? new BrokenMp4(mimeType) : new FakeRecorder(mimeType);
        created.push(recorder);
        return recorder as unknown as MediaRecorder;
      },
    });
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    await settle();
    await settle();
    expect(created.map((r) => r.mimeType)).toEqual(['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus']);
    expect(result.current.view.phase).toBe('recording');
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    elapse(2_000);
    act(() => result.current.stop());
    await settle();
    expect(takes).toHaveLength(1);
    expect(takes[0]!.take.file.type).toBe('audio/webm');
  });

  it('cancel throws the take away and releases the mic', async () => {
    const { result, track, takes, elapse, settle } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(2_000);
    act(() => result.current.cancel());
    await settle();
    expect(takes).toHaveLength(0);
    expect(track.stopped).toBe(true);
    expect(result.current.view.phase).toBe('idle');
  });

  it('a take shorter than the minimum is dropped with a notice', async () => {
    const { result, takes, elapse, settle } = setup();
    await act(async () => { await result.current.start('conv-1', 'hold'); });
    elapse(MIN_TAKE_MS - 200);
    act(() => result.current.stop());
    await settle();
    expect(takes).toHaveLength(0);
    expect(result.current.view.notice).toBe('tooShort');
  });

  it('stops by itself at the duration limit and keeps the take', async () => {
    const { result, takes, elapse, settle } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(MAX_VOICE_DURATION_MS + 1_000);
    await settle();
    expect(takes).toHaveLength(1);
    expect(takes[0]!.take.durationMs).toBe(MAX_VOICE_DURATION_MS);
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['NotFoundError', 'noDevice'],
    ['TypeError', 'failed'],
  ])('a mic request refused with %s ends idle with the "%s" notice', async (name, notice) => {
    const { result } = setup({ getUserMedia: vi.fn(async () => { throw domError(name); }) });
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    expect(result.current.view).toMatchObject({ phase: 'idle', notice });
  });

  it('a browser without MediaRecorder says so without asking for the mic', async () => {
    const getUserMedia = vi.fn();
    const { result } = setup({ createRecorder: null, getUserMedia });
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    expect(result.current.view.notice).toBe('unsupported');
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('cancelled while the permission prompt is up: the mic that arrives later is released at once', async () => {
    let grant!: (stream: MediaStream) => void;
    const fake = fakeRecorderEnv();
    const pending = new Promise<MediaStream>((resolve) => { grant = resolve; });
    const { result } = renderHook(() => useVoiceRecorder({ env: { ...fake.env, getUserMedia: () => pending }, onTake: vi.fn() }));
    let started!: Promise<void>;
    act(() => { started = result.current.start('conv-1', 'locked'); });
    act(() => result.current.cancel());
    await act(async () => { grant({ getTracks: () => [fake.track], getAudioTracks: () => [fake.track] } as unknown as MediaStream); await started; });
    expect(fake.track.stopped).toBe(true);
    expect(fake.recorders).toHaveLength(0);
    expect(result.current.view.phase).toBe('idle');
  });

  it('flags digital silence (a muted or borrowed mic) and clears it once sound arrives', async () => {
    const { result, reading, elapse } = setup();
    reading.current = { rms: 0, peak: 0 };
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(1_000);
    expect(result.current.view.silent).toBe(false);
    elapse(2_000);
    expect(result.current.view.silent).toBe(true);
    reading.current = { rms: 0.1, peak: 0.4 };
    elapse(200);
    expect(result.current.view.silent).toBe(false);
  });

  it('does not call it silence when no reading is possible (no audio context)', async () => {
    const { result, reading, elapse } = setup();
    reading.current = null;
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(5_000);
    expect(result.current.view.silent).toBe(false);
  });

  it('a track the system mutes (a phone call, another app) shows as silent', async () => {
    const { result, track, elapse } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    act(() => track.fire('mute'));
    elapse(100);
    expect(result.current.view.silent).toBe(true);
  });

  it('a track the system ends (backgrounded on mobile) keeps what was recorded', async () => {
    const { result, track, takes, elapse, settle } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(4_000);
    act(() => track.fire('ended'));
    await settle();
    expect(takes).toHaveLength(1);
    expect(takes[0]!.take.durationMs).toBe(4_000);
  });

  it('unmounting mid-take still delivers the take (it becomes a draft)', async () => {
    const { result, unmount, takes, elapse, settle } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    elapse(2_000);
    unmount();
    await settle();
    expect(takes).toHaveLength(1);
  });

  it('only one take at a time: a second start while recording is ignored', async () => {
    const { result, getUserMedia } = setup();
    await act(async () => { await result.current.start('conv-1', 'locked'); });
    await act(async () => { await result.current.start('conv-2', 'locked'); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
