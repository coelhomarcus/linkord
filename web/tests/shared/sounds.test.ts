import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSound } from '@/shared/sounds';
import { setDoNotDisturb } from '@/shared/doNotDisturb';

let played: string[] = [];

class FakeAudio {
  src: string;
  paused = true;
  currentTime = 0;
  volume = 1;
  preload = '';
  constructor(src: string) { this.src = src; }
  load() {}
  play() { played.push(this.src); return Promise.resolve(); }
}

beforeEach(() => {
  played = [];
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  setDoNotDisturb(false);
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
