import { useCallback, useEffect, useState } from 'react';

import { checkUsernameAvailability } from '@/shared/api/api';
import { describeApiError } from '@/shared/api/errorText';
import { USERNAME_RE } from '@/features/auth/credentialRules';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';

/** Long enough that a name is asked about once it is typed, not once per letter: the server limits the checks. */
export const USERNAME_CHECK_DEBOUNCE_MS = 400;

export type UsernameAvailabilityStatus = 'idle' | 'current' | 'invalid' | 'checking' | 'available' | 'taken' | 'error';

interface Answer { name: string; status: 'available' | 'taken' | 'error'; error?: string }

/** Whether `value` is free for this account, asked while the person types. Nothing is asked for an empty
 * value, for the current name as it is (`current`), or for a name the rules refuse (`invalid`). An answer
 * only counts for the name it was asked about, so a slow reply never labels what is typed now. The server
 * checks again on save; `markTaken` records a save that lost the name to someone else. */
export function useUsernameAvailability(value: string, currentUsername: string) {
  const name = value.trim();
  const debounced = useDebouncedValue(name, USERNAME_CHECK_DEBOUNCE_MS);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const needsCheck = name !== '' && name !== currentUsername && USERNAME_RE.test(name);

  useEffect(() => {
    if (!needsCheck || debounced !== name) return;
    const controller = new AbortController();
    checkUsernameAvailability(debounced, controller.signal)
      .then((result) => setAnswer({ name: debounced, status: result.available ? 'available' : 'taken' }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setAnswer({ name: debounced, status: 'error', error: describeApiError(err, 'settings:account.username.checkFailed') });
      });
    return () => controller.abort();
  }, [debounced, name, needsCheck]);

  const markTaken = useCallback((taken: string) => setAnswer({ name: taken, status: 'taken' }), []);

  let status: UsernameAvailabilityStatus;
  if (!name) status = 'idle';
  else if (name === currentUsername) status = 'current';
  else if (!USERNAME_RE.test(name)) status = 'invalid';
  else if (answer?.name === name) status = answer.status;
  else status = 'checking';

  return { status, error: status === 'error' ? answer?.error ?? null : null, markTaken };
}
