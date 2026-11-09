import { loadDevicePreference } from '@/features/settings/useDevicePreference';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { soundFileUrl } from './soundboardApi';

let context: AudioContext | null = null;
let appliedSinkId: string | null = null;
const buffers = new Map<string, Promise<AudioBuffer>>();

type SinkableContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** One context for every sound, following the speaker saved in Settings the
 * same way the call's own <audio> elements do (ParticipantAudioLayer.tsx).
 * AudioContext.setSinkId is Chromium-only; elsewhere it plays on the default. */
function audioContext(): AudioContext {
  context ??= new AudioContext();
  const sinkId = loadDevicePreference('audiooutput');
  const sinkable = context as SinkableContext;
  if (sinkId && sinkId !== appliedSinkId && typeof sinkable.setSinkId === 'function') {
    appliedSinkId = sinkId;
    sinkable.setSinkId(sinkId).catch(() => { appliedSinkId = null; });
  }
  if (context.state === 'suspended') void context.resume().catch(() => {});
  return context;
}

/** This listener's own soundboard volume (0..1), on top of each sound's. */
export function loadSoundboardVolume(): number {
  const stored = localStorageStore.get(LOCAL_STORAGE_KEYS.soundboardVolume);
  const v = Number(stored);
  return stored !== null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

export function saveSoundboardVolume(value: number): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.soundboardVolume, String(Math.max(0, Math.min(1, value))));
}

/** Fetched and decoded once per sound; a sound's file never changes (an edit
 * only touches name/emoji/volume), so the decoded buffer stays valid. `token`
 * comes with a play from a server the listener may not be in. */
export function loadSoundBuffer(serverId: string, soundId: string, token?: string): Promise<AudioBuffer> {
  const key = `${serverId}:${soundId}`;
  let pending = buffers.get(key);
  if (!pending) {
    pending = fetch(soundFileUrl(serverId, soundId, token), { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`sound ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => audioContext().decodeAudioData(data));
    pending.catch(() => buffers.delete(key));
    buffers.set(key, pending);
  }
  return pending;
}

export interface PlayingSound {
  stop: () => void;
  /** AudioContext time the clip started at, for drawing a playhead */
  startedAt: number;
  context: AudioContext;
  ended: Promise<void>;
}

/** Plays [startSec, endSec) of a buffer at `gain` (0..1). */
export function playBuffer(buffer: AudioBuffer, gain: number, startSec = 0, endSec = buffer.duration): PlayingSound {
  const ctx = audioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gainNode = ctx.createGain();
  gainNode.gain.value = Math.max(0, gain);
  source.connect(gainNode).connect(ctx.destination);
  const ended = new Promise<void>((resolve) => { source.onended = () => resolve(); });
  source.start(0, startSec, Math.max(0, endSec - startSec));
  return {
    stop: () => { try { source.stop(); } catch { /* already stopped */ } },
    startedAt: ctx.currentTime,
    context: ctx,
    ended,
  };
}

/** A group sound at its own volume times this listener's soundboard volume. */
export async function playServerSound(serverId: string, soundId: string, volume: number, token?: string): Promise<PlayingSound> {
  const buffer = await loadSoundBuffer(serverId, soundId, token);
  return playBuffer(buffer, (volume / 100) * loadSoundboardVolume());
}
