import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playSound } from '@/shared/sounds';
import { getSoundPreferences, setSoundPreference, soundGroupEnabled } from '@/shared/soundPreferences';

const play = vi.fn(() => Promise.resolve());

beforeEach(() => {
  localStorage.clear();
  play.mockClear();
  vi.stubGlobal('Audio', class { volume = 1; currentTime = 0; paused = true; preload = ''; play = play; load() {} });
});

describe('sound preferences', () => {
  it('every group plays by default', () => {
    expect(getSoundPreferences()).toEqual({ message: true, mention: true, call: true, muteAll: false });
  });

  it('a switched-off group stays quiet, and the others keep playing', () => {
    setSoundPreference('message', false);
    playSound('newMessage');
    expect(play).not.toHaveBeenCalled();
    playSound('mention');
    playSound('muted');
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('"disable all" silences every group but keeps their own switches for later', () => {
    setSoundPreference('muteAll', true);
    playSound('incomingUser');
    playSound('mention');
    expect(play).not.toHaveBeenCalled();
    expect(getSoundPreferences().mention).toBe(true);
    setSoundPreference('muteAll', false);
    expect(soundGroupEnabled('mention')).toBe(true);
  });

  it('a preview plays even a silenced sound', () => {
    setSoundPreference('muteAll', true);
    playSound('newMessage', { force: true });
    expect(play).toHaveBeenCalledOnce();
  });

  it('a damaged stored value falls back to the defaults', () => {
    localStorage.setItem('ss-sounds', '{not json');
    expect(getSoundPreferences()).toEqual({ message: true, mention: true, call: true, muteAll: false });
  });
});
