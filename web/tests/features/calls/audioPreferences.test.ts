import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { getAudioPreferences, setAudioPreference, useAudioPreferences } from '@/features/calls/audioPreferences';

afterEach(() => localStorage.clear());

describe('audioPreferences', () => {
  it('defaults to full volumes and voice isolation', () => {
    expect(getAudioPreferences()).toEqual({ inputVolume: 1, inputProfile: 'voice-isolation', outputVolume: 1 });
  });

  it('clamps a stored volume out of range and ignores garbage', () => {
    localStorage.setItem('ss-input-volume', '3');
    localStorage.setItem('ss-output-volume', 'loud');
    expect(getAudioPreferences()).toMatchObject({ inputVolume: 1, outputVolume: 1 });
  });

  it('returns the same object while nothing changed', () => {
    expect(getAudioPreferences()).toBe(getAudioPreferences());
  });

  it('notifies subscribers when a preference is set', () => {
    const { result } = renderHook(() => useAudioPreferences());
    act(() => setAudioPreference('outputVolume', 0.3));
    expect(result.current.outputVolume).toBe(0.3);
    act(() => setAudioPreference('inputProfile', 'studio'));
    expect(result.current.inputProfile).toBe('studio');
  });
});
