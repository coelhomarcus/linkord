import { afterEach, describe, expect, it } from 'vitest';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';
import { loadMemberListOpen, saveMemberListOpen } from '@/features/servers/memberListPreference';

describe('memberListPreference', () => {
  afterEach(() => localStorage.removeItem(LOCAL_STORAGE_KEYS.memberListOpen));

  it('starts open when the browser has no saved preference', () => {
    expect(loadMemberListOpen()).toBe(true);
  });

  it('keeps the list closed after a reload when the user closes it', () => {
    saveMemberListOpen(false);
    expect(loadMemberListOpen()).toBe(false);
  });

  it('keeps the list open after a reload when the user reopens it', () => {
    saveMemberListOpen(false);
    saveMemberListOpen(true);
    expect(loadMemberListOpen()).toBe(true);
  });

  it('treats invalid stored values as the default open state', () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.memberListOpen, 'invalid');
    expect(loadMemberListOpen()).toBe(true);
  });
});
