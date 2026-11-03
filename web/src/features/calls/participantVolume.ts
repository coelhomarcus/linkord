import { getAudioPreferences } from './audioPreferences';

// An element plays at its participant's own volume times the output volume,
// so the participant's part is kept beside it: reading it back from
// `volume` would fold the output volume into the per-person slider.
export function setParticipantVolume(el: HTMLAudioElement, volume: number, outputVolume = getAudioPreferences().outputVolume): void {
  el.dataset.participantVolume = String(volume);
  el.volume = volume * outputVolume;
}

export function getParticipantVolume(el: HTMLAudioElement): number {
  const stored = el.dataset.participantVolume;
  const v = stored === undefined ? NaN : Number(stored);
  return Number.isFinite(v) ? v : el.volume;
}
