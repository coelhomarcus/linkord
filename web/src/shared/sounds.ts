import connectUrl from 'uisfx/sounds/soft/connect.mp3?url';
import disconnectUrl from 'uisfx/sounds/soft/disconnect.mp3?url';
import lockUrl from 'uisfx/sounds/soft/lock.mp3?url';
import mentionUrl from 'uisfx/sounds/soft/mention.mp3?url';
import notificationUrl from 'uisfx/sounds/soft/notification.mp3?url';
import receiveUrl from 'uisfx/sounds/soft/receive.mp3?url';
import startUrl from 'uisfx/sounds/soft/start.mp3?url';
import toggleOffUrl from 'uisfx/sounds/soft/toggle-off.mp3?url';
import toggleOnUrl from 'uisfx/sounds/soft/toggle-on.mp3?url';
import unlockUrl from 'uisfx/sounds/soft/unlock.mp3?url';
import wakeUrl from 'uisfx/sounds/soft/wake.mp3?url';
import { soundGroupEnabled, type SoundGroup } from './soundPreferences';
import { isDoNotDisturb } from './doNotDisturb';

// UI SFX (uisfx), "soft" pack, named by what happened rather than what it
// sounds like. Changing the pack means changing the folder in these imports.
const SOUND_FILES = {
  muted: toggleOffUrl,
  unmuted: toggleOnUrl,
  deafened: lockUrl,
  undeafened: unlockUrl,
  userLeave: disconnectUrl,
  incomingUser: connectUrl,
  newMessage: receiveUrl,
  mention: mentionUrl,
  screenshare: startUrl,
  camera: wakeUrl,
} as const;

/** Plain URL, not part of the pool below: the speaker test has to play on one
 * specific output device, which only a dedicated <audio> element can do. */
export const SPEAKER_TEST_SOUND_URL = notificationUrl;

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
