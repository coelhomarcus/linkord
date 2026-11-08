import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDevicePreference } from '@/features/settings/useDevicePreference';
import { logger } from '@/shared/lib/logger';
import { createLevelMeter, primeAudioContext, type LevelMeter } from './levelMeter';
import { baseMime, encodeWaveform, MAX_VOICE_DURATION_MS, recorderMimeCandidates, resampleLevels } from './voiceFormat';

const log = logger.child({ component: 'voice-recorder' });

const TICK_MS = 100;
// A take this short is a slip of the finger, not a message.
export const MIN_TAKE_MS = 700;
// Digital silence (every sample exactly 0) for this long means the system is
// handing us a muted or borrowed mic; a quiet room still has a noise floor.
const SILENCE_AFTER_MS = 2_500;
const SILENCE_PEAK = 1e-6;
// Spoken voice sits around 0.05-0.2 RMS; scaled so it fills the meter.
const LEVEL_GAIN = 4;

export type RecorderMode = 'locked' | 'hold';
export type RecorderNotice = 'denied' | 'busy' | 'noDevice' | 'unsupported' | 'failed' | 'tooShort';

export interface VoiceTake {
  file: File;
  durationMs: number;
  waveform: string;
  /** object URL of `file` for the review player; revoked with the draft */
  url: string;
}

export type RecorderPhase = 'idle' | 'requesting' | 'recording';

export interface RecorderView {
  phase: RecorderPhase;
  mode: RecorderMode;
  elapsedMs: number;
  /** 0..1, the last few readings, newest last, for the live meter */
  recentLevels: readonly number[];
  /** no sound at all for a while, or the system muted the track */
  silent: boolean;
  notice: RecorderNotice | null;
}

/** Everything the recorder takes from the browser, so tests can stand in for it. */
export interface RecorderEnv {
  getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | null;
  createRecorder: ((stream: MediaStream, mimeType: string) => MediaRecorder) | null;
  isTypeSupported: (type: string) => boolean;
  createLevelMeter: (stream: MediaStream) => LevelMeter | null;
  primeAudio: () => void;
  now: () => number;
  makeUrl: (blob: Blob) => string;
  fileName: (mime: string) => string;
}

export function browserRecorderEnv(fileName: (mime: string) => string): RecorderEnv {
  const Recorder = typeof MediaRecorder === 'undefined' ? null : MediaRecorder;
  return {
    getUserMedia: navigator.mediaDevices?.getUserMedia ? (c) => navigator.mediaDevices.getUserMedia(c) : null,
    createRecorder: Recorder ? (stream, mimeType) => new Recorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined) : null,
    isTypeSupported: (type) => Recorder?.isTypeSupported(type) ?? false,
    createLevelMeter,
    primeAudio: primeAudioContext,
    now: () => performance.now(),
    makeUrl: (blob) => URL.createObjectURL(blob),
    fileName,
  };
}

export function noticeForError(err: unknown): RecorderNotice {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'noDevice';
  // Windows hands the device to one app at a time; another call holding it
  // fails here instead of returning silence
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'failed';
}

interface Session {
  conversationId: string;
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  meter: LevelMeter | null;
  chunks: Blob[];
  levels: number[];
  startedAt: number;
  heardSound: boolean;
  trackMuted: boolean;
  cancelled: boolean;
  finished: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

interface Options {
  /** Receives the finished take, with the conversation it was recorded in —
   * not necessarily the one on screen by the time it stops. */
  onTake: (take: VoiceTake, conversationId: string) => void;
  env: RecorderEnv;
}

const METER_READINGS = 32;
const IDLE: RecorderView = { phase: 'idle', mode: 'locked', elapsedMs: 0, recentLevels: [], silent: false, notice: null };

/** One recording at a time: asks for the mic only when started, and gives it
 * back (tracks stopped) the moment the take ends, however it ends. */
export function useVoiceRecorder({ onTake, env }: Options) {
  const [view, setView] = useState<RecorderView>(IDLE);
  const sessionRef = useRef<Session | null>(null);
  const onTakeRef = useRef(onTake);
  useEffect(() => { onTakeRef.current = onTake; }, [onTake]);
  const envRef = useRef(env);
  useEffect(() => { envRef.current = env; }, [env]);

  const release = useCallback((session: Session) => {
    if (session.timer) clearInterval(session.timer);
    session.timer = null;
    session.meter?.close();
    session.meter = null;
    for (const track of session.stream?.getTracks() ?? []) track.stop();
    session.stream = null;
  }, []);

  const finish = useCallback((session: Session) => {
    // an error event and the stop that follows it both land here
    if (session.finished) return;
    session.finished = true;
    const elapsed = Math.min(MAX_VOICE_DURATION_MS, envRef.current.now() - session.startedAt);
    release(session);
    if (sessionRef.current === session) sessionRef.current = null;
    if (session.cancelled) {
      setView((v) => ({ ...IDLE, notice: v.notice }));
      return;
    }
    const recordedType = session.recorder?.mimeType || session.chunks[0]?.type || 'audio/webm';
    const blob = new Blob(session.chunks, { type: recordedType });
    if (elapsed < MIN_TAKE_MS || blob.size === 0) {
      setView({ ...IDLE, notice: 'tooShort' });
      return;
    }
    const file = new File([blob], envRef.current.fileName(recordedType), { type: baseMime(recordedType) });
    const take: VoiceTake = {
      file,
      durationMs: Math.round(elapsed),
      waveform: encodeWaveform(resampleLevels(session.levels)),
      url: envRef.current.makeUrl(file),
    };
    setView(IDLE);
    onTakeRef.current(take, session.conversationId);
  }, [release]);

  const stopSession = useCallback((session: Session) => {
    if (session.timer) clearInterval(session.timer);
    session.timer = null;
    const recorder = session.recorder;
    if (recorder && recorder.state !== 'inactive') {
      // the last chunk arrives with the stop event, so finish waits for it
      recorder.stop();
    } else {
      finish(session);
    }
  }, [finish]);

  const tick = useCallback((session: Session) => {
    const elapsed = envRef.current.now() - session.startedAt;
    const reading = session.meter?.read() ?? null;
    if (reading) {
      session.levels.push(reading.rms);
      if (reading.peak > SILENCE_PEAK) session.heardSound = true;
    }
    // no reading at all (no audio context) says nothing about the mic
    const silent = session.trackMuted || (!!reading && !session.heardSound && elapsed >= SILENCE_AFTER_MS);
    setView((v) => (v.phase === 'recording'
      ? {
        ...v, elapsedMs: Math.min(elapsed, MAX_VOICE_DURATION_MS), silent,
        recentLevels: [...v.recentLevels, reading ? Math.min(1, reading.rms * LEVEL_GAIN) : 0].slice(-METER_READINGS),
      }
      : v));
    if (elapsed >= MAX_VOICE_DURATION_MS) stopSession(session);
  }, [stopSession]);

  /** Called inside the gesture that will start a recording (see levelMeter.ts). */
  const prime = useCallback(() => { envRef.current.primeAudio(); }, []);

  const start = useCallback(async (conversationId: string, mode: RecorderMode) => {
    if (sessionRef.current) return;
    const current = envRef.current;
    if (!current.getUserMedia || !current.createRecorder) {
      setView({ ...IDLE, notice: 'unsupported' });
      return;
    }
    const session: Session = {
      conversationId, stream: null, recorder: null, meter: null, chunks: [], levels: [],
      startedAt: 0, heardSound: false, trackMuted: false, cancelled: false, finished: false, timer: null,
    };
    sessionRef.current = session;
    setView({ ...IDLE, phase: 'requesting', mode });

    const preferred = loadDevicePreference('audioinput');
    let stream: MediaStream;
    try {
      stream = await current.getUserMedia({
        audio: {
          // ideal, not exact: a device unplugged since it was picked falls
          // back to the default one instead of failing the recording
          ...(preferred && preferred !== 'default' ? { deviceId: { ideal: preferred } } : {}),
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        },
      });
    } catch (err) {
      if (sessionRef.current === session) sessionRef.current = null;
      if (session.cancelled) { setView(IDLE); return; }
      const notice = noticeForError(err);
      if (notice === 'failed') log.error('microphone request failed', err);
      setView({ ...IDLE, notice });
      return;
    }
    session.stream = stream;
    // cancelled (or the composer went away) while the permission prompt was up
    if (session.cancelled) { release(session); setView(IDLE); return; }

    const candidates = recorderMimeCandidates(current.isTypeSupported);
    const startRecorder = (index: number): boolean => {
      let recorder: MediaRecorder;
      try {
        recorder = current.createRecorder!(stream, candidates[index]!);
      } catch (err) {
        if (index + 1 < candidates.length) return startRecorder(index + 1);
        log.error('MediaRecorder could not start', err);
        return false;
      }
      session.recorder = recorder;
      // events from a recorder that was replaced by the fallback are ignored
      const isCurrent = () => session.recorder === recorder;
      recorder.addEventListener('dataavailable', (event) => { if (isCurrent() && event.data.size > 0) session.chunks.push(event.data); });
      recorder.addEventListener('stop', () => { if (isCurrent()) finish(session); });
      recorder.addEventListener('error', (event) => {
        if (!isCurrent()) return;
        const error = (event as Event & { error?: unknown }).error ?? event;
        // failed before recording anything: the format was the problem, so
        // the same stream goes to the next one and the clock starts over
        if (!session.chunks.length && index + 1 < candidates.length && !session.finished) {
          log.warn('recorder format failed, trying the next one', { mimeType: candidates[index] });
          session.levels = [];
          session.startedAt = envRef.current.now();
          if (!startRecorder(index + 1)) { session.recorder = null; stopSession(session); }
          return;
        }
        log.error('recording failed', error);
        stopSession(session);
      });
      // timeslice: what was captured survives a recorder that dies mid-take
      recorder.start(1000);
      return true;
    };

    const [track] = stream.getAudioTracks();
    if (track) {
      session.trackMuted = track.muted;
      track.addEventListener('mute', () => { session.trackMuted = true; });
      track.addEventListener('unmute', () => { session.trackMuted = false; });
      // the device went away, or a mobile OS took the mic back while the app
      // was in the background: keep what was recorded so far
      track.addEventListener('ended', () => stopSession(session));
    }

    session.meter = current.createLevelMeter(stream);
    session.startedAt = current.now();
    if (!startRecorder(0)) {
      release(session);
      sessionRef.current = null;
      setView({ ...IDLE, notice: 'unsupported' });
      return;
    }
    session.timer = setInterval(() => tick(session), TICK_MS);
    setView((v) => ({ ...v, phase: 'recording', elapsedMs: 0, silent: session.trackMuted }));
  }, [finish, release, stopSession, tick]);

  /** Ends the take and hands it to onTake (or discards one too short to keep). */
  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    // still waiting on the permission prompt: nothing recorded to keep
    if (!session.recorder) { session.cancelled = true; sessionRef.current = null; setView(IDLE); return; }
    stopSession(session);
  }, [stopSession]);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    if (!session.recorder) { sessionRef.current = null; setView(IDLE); return; }
    stopSession(session);
  }, [stopSession]);

  /** A hold that turned into a permission prompt: the finger is long gone by
   * the time the mic opens, so the take continues hands-free. */
  const lock = useCallback(() => setView((v) => (v.phase === 'idle' ? v : { ...v, mode: 'locked' })), []);

  const dismissNotice = useCallback(() => setView((v) => ({ ...v, notice: null })), []);

  // whatever is recording when the composer goes away is kept as a draft
  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    if (!session.recorder) { session.cancelled = true; return; }
    stopSession(session);
  }, [stopSession]);

  return { view, start, stop, cancel, lock, prime, dismissNotice };
}
