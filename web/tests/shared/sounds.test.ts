import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSound, startRingtone } from '@/shared/sounds';
import { setSoundPreference } from '@/shared/soundPreferences';
import { setDoNotDisturb } from '@/shared/doNotDisturb';

let played: string[] = [];
let paused: string[] = [];

class FakeAudio {
  src: string;
  paused = true;
  loop = false;
  currentTime = 0;
  volume = 1;
  preload = '';
  constructor(src: string) { this.src = src; }
  load() {}
  play() { played.push(this.src); return Promise.resolve(); }
  pause() { paused.push(this.src); }
}

beforeEach(() => {
  played = [];
  paused = [];
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  setDoNotDisturb(false);
  setSoundPreference('call', true);
  vi.unstubAllGlobals();
});

describe('playSound in do not disturb', () => {
  it('silences message and mention sounds', () => {
    setDoNotDisturb(true);
    playSound('newMessage');
    playSound('mention');
    expect(played).toHaveLength(0);
  });

  it('keeps the sounds of your own call', () => {
    setDoNotDisturb(true);
    playSound('muted');
    playSound('incomingUser');
    expect(played).toHaveLength(2);
  });

  it('plays again once it is turned off, and the settings preview always plays', () => {
    setDoNotDisturb(true);
    playSound('newMessage', { force: true });
    setDoNotDisturb(false);
    playSound('newMessage');
    expect(played).toHaveLength(2);
  });
});

describe('startRingtone', () => {
  it('loops the ringtone until it is stopped', () => {
    const stop = startRingtone('incoming');
    expect(played).toEqual(['/audio/call-ringing.mp3']);
    expect(paused).toHaveLength(0);
    stop();
    expect(paused).toEqual(['/audio/call-ringing.mp3']);
  });

  it('stays quiet for an incoming call in do not disturb, but rings for one you placed', () => {
    setDoNotDisturb(true);
    startRingtone('incoming');
    expect(played).toHaveLength(0);
    startRingtone('outgoing');
    expect(played).toHaveLength(1);
  });

  it('follows the call sounds switch', () => {
    setSoundPreference('call', false);
    startRingtone('outgoing')();
    expect(played).toHaveLength(0);
  });
});
