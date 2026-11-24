import { getAudioPreferences } from './audioPreferences';

// An element plays at its participant's own volume times the output volume
// times, in a playground, how near they stand (features/playground/proximity.ts).
// Each part is kept beside it: reading it back from `volume` would fold the
// others into the per-person slider.
export function setParticipantVolume(el: HTMLAudioElement, volume: number, outputVolume = getAudioPreferences().outputVolume): void {
  el.dataset.participantVolume = String(volume);
  el.volume = clampVolume(volume * outputVolume * getSpatialGain(el));
}

export function getParticipantVolume(el: HTMLAudioElement): number {
  const stored = el.dataset.participantVolume;
  const v = stored === undefined ? NaN : Number(stored);
  return Number.isFinite(v) ? v : el.volume;
}

/** The distance part of the volume; 1 outside a playground. */
export function setSpatialGain(el: HTMLAudioElement, gain: number): void {
  if (getSpatialGain(el) === gain && el.dataset.spatialGain !== undefined) return;
  el.dataset.spatialGain = String(gain);
  el.volume = clampVolume(getParticipantVolume(el) * getAudioPreferences().outputVolume * gain);
}

export function clearSpatialGain(el: HTMLAudioElement): void {
  if (el.dataset.spatialGain === undefined) return;
  delete el.dataset.spatialGain;
  el.volume = clampVolume(getParticipantVolume(el) * getAudioPreferences().outputVolume);
}

function getSpatialGain(el: HTMLAudioElement): number {
  const stored = el.dataset.spatialGain;
  const v = stored === undefined ? NaN : Number(stored);
  return Number.isFinite(v) ? v : 1;
}

const clampVolume = (v: number) => Math.min(Math.max(v, 0), 1);
