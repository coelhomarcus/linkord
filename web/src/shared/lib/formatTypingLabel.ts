import { i18n } from '@/shared/i18n/init';

// Caps at naming 3 people (matches the avatar stack in TypingIndicator.tsx,
// same rolling-name threshold Discord/Fluxer use) — beyond that a growing
// list of names reads worse than a plain count, so it falls back to a
// generic line instead of "Ana and 7 more are typing...".
const MAX_NAMED = 3;

/** "Ana is typing...", "Ana and Bia are typing...", "Ana, Bia and Caio are
 * typing...", or, beyond 3 people, "Several people are typing...". */
export function formatTypingLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return i18n.t('common:typing.one', { name: names[0] });
  if (names.length <= MAX_NAMED) {
    return i18n.t('common:typing.some', { names: new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' }).format(names) });
  }
  return i18n.t('common:typing.many');
}
