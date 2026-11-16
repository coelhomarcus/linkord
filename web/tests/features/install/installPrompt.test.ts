import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  installMethod, useInstall,
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

describe('useInstall in the desktop app', () => {
  afterEach(() => { delete window.linkordDesktop; });

  it('offers no install: the desktop app is the installed app', () => {
    window.linkordDesktop = { platform: 'win32', version: '0.1.0' };
    const { result } = renderHook(() => useInstall());
    expect(result.current.method).toBeNull();
  });
});
