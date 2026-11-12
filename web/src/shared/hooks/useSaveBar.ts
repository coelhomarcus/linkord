import { useEffect, useState } from 'react';
import { describeApiError } from '@/shared/api/errorText';
import { SAVED_BAR_MS, type SaveBarStatus } from '@/shared/FloatingBar';

/** The state of a settings form's save bar: shown while the draft differs from what is saved, while
 * saving, and for a moment after a save to confirm it. The draft that was saved is kept, not a flag: the
 * saved value can reach the form after the request resolves, and until then the draft still reads as
 * dirty, yet only an edit made after the save is a new pending change. */
export function useSaveBar(draft: unknown, dirty: boolean) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const current = JSON.stringify(draft);
  const justSaved = saved !== null && saved === current;

  useEffect(() => {
    if (saved === null) return;
    const timeout = window.setTimeout(() => setSaved(null), SAVED_BAR_MS);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  /** `describeError` words a failure the form knows better than the generic code text. */
  async function save(persist: () => Promise<unknown>, describeError: (err: unknown) => string = describeApiError) {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      await persist();
      setSaved(current);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  const status: SaveBarStatus = saving ? 'saving' : justSaved ? 'saved' : error ? 'error' : 'pending';
  return {
    visible: saving || justSaved || dirty,
    status,
    error,
    save,
    /** forget a failed save's message, for when the edits are thrown away */
    clearError: () => setError(null),
  };
}
