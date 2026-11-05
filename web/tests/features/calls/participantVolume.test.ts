import { afterEach, describe, expect, it } from 'vitest';
import { getParticipantVolume, setParticipantVolume } from '@/features/calls/participantVolume';
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
});
