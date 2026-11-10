import { useCallback } from 'react';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { useTransientFlag } from './useTransientFlag';

/** How long a copy control shows its check mark and "Copied" before going back to what it was. */
export const COPIED_FOR_MS = 1500;

/** The state behind every copy button: `copy` writes and announces "Copied" (see `copyToClipboard`),
 * and `copied` is on for `COPIED_FOR_MS` after a copy that worked, for the check mark and the label.
 * `reset` turns it off at once, for a control that is reused for something else (a dialog reopened). */
export function useCopyToClipboard() {
  const [copied, raise, reset] = useTransientFlag(COPIED_FOR_MS);
  const copy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text);
    if (ok) raise();
    return ok;
  }, [raise]);
  return { copied, copy, reset };
}
