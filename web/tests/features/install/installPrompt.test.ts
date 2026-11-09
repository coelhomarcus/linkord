import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSIONS_BEFORE_BANNER, dismissInstallBanner, installMethod, isDismissed, readInstallSessions, recordInstallSession, shouldShowInstallBanner,
} from '@/features/install/installPrompt';

describe('installMethod', () => {
  it('offers the browser dialog when it handed one over', () => {
    expect(installMethod({ standalone: false, canPrompt: true, ios: false })).toBe('prompt');
  });

  it('gives iOS instructions, since Safari has no install dialog to open', () => {
    expect(installMethod({ standalone: false, canPrompt: false, ios: true })).toBe('ios');
  });

  it('offers nothing in a browser that cannot install', () => {
    expect(installMethod({ standalone: false, canPrompt: false, ios: false })).toBeNull();
  });

  it('offers nothing once the app runs standalone, whatever else is true', () => {
    expect(installMethod({ standalone: true, canPrompt: true, ios: true })).toBeNull();
  });
});

describe('shouldShowInstallBanner', () => {
  const base = { method: 'prompt', dismissed: false, sessions: SESSIONS_BEFORE_BANNER, inCall: false } as const;

  it('shows once enough sessions have passed', () => {
    expect(shouldShowInstallBanner(base)).toBe(true);
    expect(shouldShowInstallBanner({ ...base, method: 'ios' })).toBe(true);
  });

  it('stays away from the first visits', () => {
    expect(shouldShowInstallBanner({ ...base, sessions: 1 })).toBe(false);
    expect(shouldShowInstallBanner({ ...base, sessions: SESSIONS_BEFORE_BANNER - 1 })).toBe(false);
  });

  it('stays away after it was dismissed', () => {
    expect(shouldShowInstallBanner({ ...base, dismissed: true })).toBe(false);
  });

  it('stays away during a call', () => {
    expect(shouldShowInstallBanner({ ...base, inCall: true })).toBe(false);
  });

  it('stays away when there is no way to install', () => {
    expect(shouldShowInstallBanner({ ...base, method: null })).toBe(false);
  });
});

describe('dismissal and session count', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('remembers a dismissal on this device', () => {
    expect(isDismissed()).toBe(false);
    dismissInstallBanner();
    expect(isDismissed()).toBe(true);
  });

  it('counts a session once, however often it is recorded again', () => {
    sessionStorage.clear();
    const before = readInstallSessions();
    recordInstallSession();
    recordInstallSession();
    expect(readInstallSessions()).toBe(before + 1);
  });

  it('reads garbage in storage as no sessions yet', () => {
    localStorage.setItem('ss-install-sessions', 'abc');
    expect(readInstallSessions()).toBe(0);
  });
});

describe('storage that throws', () => {
  afterEach(() => { localStorage.clear(); });

  it('does not break when the browser blocks it', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try {
      expect(isDismissed()).toBe(false);
      expect(readInstallSessions()).toBe(0);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});
