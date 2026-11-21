import { getPreference, setPreference, usePreferenceValue } from '@/shared/preferences/accountPreferences';

// The skin tone picked in the emoji picker, for the account: 0 is the
// default yellow, 1..5 light to dark. Applied wherever an emoji with tones
// is inserted from a list (the picker, the composer's suggestions).

function getSkinTone(): number {
  const n = getPreference('emojiSkinTone');
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

export function setSkinTone(tone: number): void {
  const next = Math.max(0, Math.min(5, Math.round(tone)));
  setPreference('emojiSkinTone', next === 0 ? null : next);
}

export function useSkinTone(): number {
  return usePreferenceValue(getSkinTone);
}
