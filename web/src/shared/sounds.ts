import { soundGroupEnabled, type SoundGroup } from './soundPreferences';
import { isDoNotDisturb } from './doNotDisturb';

// Files live in public/audio (see the README there for sources and licences),
// named by what happened rather than what they sound like.
const SOUND_FILES = {
  muted: '/audio/muted.mp3',
  unmuted: '/audio/unmuted.mp3',
  deafened: '/audio/deafened.mp3',
  undeafened: '/audio/undeafened.mp3',
  userLeave: '/audio/user-leave.mp3',
  incomingUser: '/audio/incoming-user.mp3',
  newMessage: '/audio/new-message.mp3',
  mention: '/audio/mention.mp3',
  screenshare: '/audio/screenshare.mp3',
  camera: '/audio/camera.mp3',
} as const;

const RINGTONE_URL = '/audio/call-ringing.mp3';

/** Plain URL, not part of the pool below: the speaker test has to play on one
 * specific output device, which only a dedicated <audio> element can do. */
export const SPEAKER_TEST_SOUND_URL = '/audio/speaker-test.mp3';

export type SoundName = keyof typeof SOUND_FILES;

/** Which settings switch silences each sound; everything a call does is one group. */
const SOUND_GROUPS: Record<SoundName, SoundGroup> = {
  newMessage: 'message',
  mention: 'mention',
  muted: 'call',
  unmuted: 'call',
  deafened: 'call',
  undeafened: 'call',
  userLeave: 'call',
  incomingUser: 'call',
  screenshare: 'call',
  camera: 'call',
};

const preloaded = new Map<SoundName, HTMLAudioElement>();

let volume = 1;

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  for (const audio of preloaded.values()) audio.volume = volume;
}

export function preloadSounds(): void {
  for (const name of Object.keys(SOUND_FILES) as SoundName[]) {
    if (preloaded.has(name)) continue;
    const audio = new Audio(SOUND_FILES[name]);
    audio.preload = 'auto';
    audio.load();
    preloaded.set(name, audio);
  }
  // Only to fill the HTTP cache, so the first ring starts without a fetch.
  const ring = new Audio(RINGTONE_URL);
  ring.preload = 'auto';
  ring.load();
}

/** Groups that tell you something happened elsewhere; "do not disturb" silences these. The call group
 * stays: those sounds answer what you just did, or happen in a call you chose to be in. */
const INTERRUPTING_GROUPS = new Set<SoundGroup>(['message', 'mention']);

/** `force` plays even a silenced sound: the preview button in settings. */
export function playSound(name: SoundName, { force = false }: { force?: boolean } = {}): void {
  if (!force && !soundGroupEnabled(SOUND_GROUPS[name])) return;
  if (!force && isDoNotDisturb() && INTERRUPTING_GROUPS.has(SOUND_GROUPS[name])) return;
  const warm = preloaded.get(name);
  const audio = warm && warm.paused ? warm : new Audio(SOUND_FILES[name]);
  if (audio === warm) audio.currentTime = 0;
  audio.volume = volume;
  audio.play().catch(() => {});
}

/** Rings until the returned function is called. An incoming ring is something that happened elsewhere,
 * so "do not disturb" silences it; an outgoing one answers what you just did and stays. */
export function startRingtone(direction: 'incoming' | 'outgoing'): () => void {
  if (!soundGroupEnabled('call')) return () => {};
  if (direction === 'incoming' && isDoNotDisturb()) return () => {};
  const audio = new Audio(RINGTONE_URL);
  audio.loop = true;
  audio.volume = volume;
  audio.play().catch(() => {});
  return () => { audio.pause(); };
}
