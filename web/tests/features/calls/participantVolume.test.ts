import { afterEach, describe, expect, it } from 'vitest';
import { clearSpatialGain, getParticipantVolume, setParticipantVolume, setSpatialGain } from '@/features/calls/participantVolume';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

afterEach(() => localStorage.clear());

describe('participantVolume', () => {
  it('plays at the participant volume times the output volume', () => {
    localStorageStore.set(LOCAL_STORAGE_KEYS.outputVolume, '0.5');
    const el = document.createElement('audio');
    setParticipantVolume(el, 0.8);
    expect(el.volume).toBeCloseTo(0.4);
    expect(getParticipantVolume(el)).toBe(0.8);
  });

  it('keeps the participant volume when the output volume changes', () => {
    const el = document.createElement('audio');
    setParticipantVolume(el, 0.6, 1);
    setParticipantVolume(el, getParticipantVolume(el), 0.25);
    expect(el.volume).toBeCloseTo(0.15);
    expect(getParticipantVolume(el)).toBe(0.6);
  });

  it('falls back to the element volume when none was set through it', () => {
    const el = document.createElement('audio');
    el.volume = 0.7;
    expect(getParticipantVolume(el)).toBe(0.7);
  });

  it('scales by distance in a playground without touching the per-person volume', () => {
    const el = document.createElement('audio');
    setParticipantVolume(el, 0.8, 1);
    setSpatialGain(el, 0.5);
    expect(el.volume).toBeCloseTo(0.4);
    // a later change of the per-person slider keeps the distance part
    setParticipantVolume(el, 0.6, 1);
    expect(el.volume).toBeCloseTo(0.3);
    expect(getParticipantVolume(el)).toBe(0.6);
    clearSpatialGain(el);
    expect(el.volume).toBeCloseTo(0.6);
  });
});
