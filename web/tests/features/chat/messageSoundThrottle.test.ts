import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BURST_QUIET_MS, GLOBAL_COOLDOWN_MS, createMessageSoundThrottle } from '@/features/chat/messageSoundThrottle';

describe('createMessageSoundThrottle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a burst from one conversation chimes once, however long it keeps going', () => {
    const shouldChime = createMessageSoundThrottle();
    expect(shouldChime('dm', false)).toBe(true);
    const chimes = [];
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(BURST_QUIET_MS - 1);
      chimes.push(shouldChime('dm', false));
    }
    expect(chimes.every((chimed) => !chimed)).toBe(true);
  });

  it('the conversation chimes again once it has been quiet long enough', () => {
    const shouldChime = createMessageSoundThrottle();
    shouldChime('dm', false);
    vi.advanceTimersByTime(BURST_QUIET_MS);
    expect(shouldChime('dm', false)).toBe(true);
  });

  it('another conversation stays silent during the global cooldown, then chimes on its next message', () => {
    const shouldChime = createMessageSoundThrottle();
    shouldChime('group', false);
    vi.advanceTimersByTime(GLOBAL_COOLDOWN_MS - 1);
    expect(shouldChime('dm', false)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldChime('dm', false)).toBe(true);
  });

  it('a mention chimes mid-burst, but still not within the global cooldown', () => {
    const shouldChime = createMessageSoundThrottle();
    shouldChime('group', false);
    vi.advanceTimersByTime(GLOBAL_COOLDOWN_MS - 1);
    expect(shouldChime('group', true)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shouldChime('group', true)).toBe(true);
    vi.advanceTimersByTime(GLOBAL_COOLDOWN_MS);
    expect(shouldChime('group', false)).toBe(false);
  });

  it('instances keep separate state', () => {
    createMessageSoundThrottle()('dm', false);
    expect(createMessageSoundThrottle()('dm', false)).toBe(true);
  });
});
