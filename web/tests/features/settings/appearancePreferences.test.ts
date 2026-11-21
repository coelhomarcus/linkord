import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { appearanceLayoutKey, applyAppearance, followAppearance, getAppearance, setDensity, setFont, setTextSize, useAppearance } from '@/features/settings/appearancePreferences';
import { getPreference } from '@/shared/preferences/accountPreferences';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';

const root = document.documentElement;

let unfollow = () => {};
beforeEach(() => { unfollow = followAppearance(); });

afterEach(() => {
  unfollow();
  localStorage.clear();
  applyAppearance();
});

describe('appearance preferences', () => {
  it('starts at the defaults, with no attribute on the page', () => {
    expect(getAppearance()).toEqual({ density: 'default', textSize: 'default', font: 'figtree' });
    applyAppearance();
    expect(root.dataset.density).toBeUndefined();
    expect(root.dataset.textSize).toBeUndefined();
    expect(root.dataset.font).toBeUndefined();
  });

  it('falls back to the default for a value this build does not know', () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.density, 'cozy');
    localStorage.setItem(LOCAL_STORAGE_KEYS.textSize, 'constructor');
    expect(getAppearance()).toEqual({ density: 'default', textSize: 'default', font: 'figtree' });
  });

  it('stores a choice and puts it on the page at once', () => {
    setDensity('compact');
    setTextSize('larger');
    setFont('system');
    expect(getPreference('density')).toBe('compact');
    // where index.html's boot script reads it
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.density)).toBe('compact');
    // text size stays on this device
    expect(getPreference('textSize')).toBeUndefined();
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.textSize)).toBe('larger');
    expect(root.getAttribute('data-density')).toBe('compact');
    expect(root.getAttribute('data-text-size')).toBe('larger');
    expect(root.getAttribute('data-font')).toBe('system');
    expect(appearanceLayoutKey()).toBe('compact:larger:system');
  });

  it('going back to a default removes the stored value and the attribute', () => {
    setTextSize('small');
    setTextSize('default');
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.textSize)).toBeNull();
    expect(root.hasAttribute('data-text-size')).toBe(false);
  });

  it('keeps the same snapshot until something changes, and re-renders readers when it does', () => {
    expect(getAppearance()).toBe(getAppearance());
    const renders = vi.fn();
    const { result } = renderHook(() => { renders(); return useAppearance(); });
    act(() => setDensity('comfortable'));
    expect(result.current.density).toBe('comfortable');
    expect(renders).toHaveBeenCalledTimes(2);
  });
});
