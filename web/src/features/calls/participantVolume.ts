import { getAudioPreferences } from './audioPreferences';

// An element plays at its participant's own volume times the output volume.
// The per-person part is kept beside it: reading it back from `volume` would
// fold the output volume into the per-person slider.
export function setParticipantVolume(el: HTMLAudioElement, volume: number, outputVolume = getAudioPreferences().outputVolume): void {
  el.dataset.participantVolume = String(volume);
  el.volume = clampVolume(volume * outputVolume);
}

export function getParticipantVolume(el: HTMLAudioElement): number {
  const stored = el.dataset.participantVolume;
  const v = stored === undefined ? NaN : Number(stored);
  return Number.isFinite(v) ? v : el.volume;
}

const clampVolume = (v: number) => Math.min(Math.max(v, 0), 1);
