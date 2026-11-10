import { i18n } from '@/shared/i18n/init';
import { announce } from './announce';

/** Puts `text` on the clipboard and says "Copied" to screen readers. Returns whether it worked: a
 * browser that refuses (no permission, an insecure page) gets no confirmation rather than a false one. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  announce(i18n.t('common:clipboard.copied'));
  return true;
}
