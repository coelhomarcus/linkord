import { vi } from 'vitest';
import type { LevelReading } from '@/features/voiceMessages/levelMeter';
import type { RecorderEnv } from '@/features/voiceMessages/useVoiceRecorder';

/** A mic track the test can mute, unmute or end, as the browser would. */
export class FakeTrack extends EventTarget {
  muted = false;
  stopped = false;
  readonly kind = 'audio';
  stop() { this.stopped = true; }
  fire(type: 'mute' | 'unmute' | 'ended') {
    if (type !== 'ended') this.muted = type === 'mute';
    this.dispatchEvent(new Event(type));
  }
}

export class FakeRecorder extends EventTarget {
  state: 'inactive' | 'recording' = 'inactive';
  readonly mimeType: string;
  constructor(mimeType: string) {
    super();
    this.mimeType = mimeType;
  }
  start() { this.state = 'recording'; }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const data = Object.assign(new Event('dataavailable'), { data: new Blob(['audio-bytes'], { type: this.mimeType }) });
    queueMicrotask(() => {
      this.dispatchEvent(data);
      this.dispatchEvent(new Event('stop'));
    });
  }
}

export interface FakeRecorderEnv {
  env: RecorderEnv;
  track: FakeTrack;
  recorders: FakeRecorder[];
  getUserMedia: ReturnType<typeof vi.fn>;
  /** what the level meter reads on the next tick; null = no audio context */
  reading: { current: LevelReading | null };
  /** moves the recorder's clock; pair it with vi.advanceTimersByTime */
  advance: (ms: number) => void;
}

/** A browser that grants the mic right away and records `audio/webm`.
 * Override `getUserMedia` to refuse, or `createRecorder` to drop support. */
export function fakeRecorderEnv(overrides: Partial<RecorderEnv> = {}): FakeRecorderEnv {
  let clock = 0;
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const recorders: FakeRecorder[] = [];
  const reading: { current: LevelReading | null } = { current: { rms: 0.1, peak: 0.3 } };
  const getUserMedia = vi.fn(async () => stream);
  const env: RecorderEnv = {
    getUserMedia,
    createRecorder: (_stream, mimeType) => {
      const recorder = new FakeRecorder(mimeType || 'audio/webm');
      recorders.push(recorder);
      return recorder as unknown as MediaRecorder;
    },
    isTypeSupported: (type) => type.startsWith('audio/webm'),
    createLevelMeter: () => ({ read: () => reading.current, close: () => {} }),
    primeAudio: () => {},
    now: () => clock,
    makeUrl: () => 'blob:voice-take',
    fileName: () => 'voice-message.webm',
    ...overrides,
  };
  return { env, track, recorders, getUserMedia, reading, advance: (ms) => { clock += ms; } };
}
