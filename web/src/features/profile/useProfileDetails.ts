import { useCallback, useEffect, useState } from 'react';
import { fetchProfileDetails } from '@/shared/api/api';
import type { ProfileDetails } from '@/shared/api/api';

type Loaded = { userId: string } & ({ status: 'ready'; details: ProfileDetails } | { status: 'error' });

/** The member-since date, friends-since date and what the caller has in common
 * with `userId`, fetched each time a profile opens (friends and groups change). */
export function useProfileDetails(userId: string | null) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const abort = new AbortController();
    fetchProfileDetails(userId, abort.signal)
      .then((details) => setLoaded({ userId, status: 'ready', details }))
      .catch(() => { if (!abort.signal.aborted) setLoaded({ userId, status: 'error' }); });
    return () => abort.abort();
  }, [userId, attempt]);

  const retry = useCallback(() => {
    setLoaded(null);
    setAttempt((n) => n + 1);
  }, []);

  // an answer about another profile reads as still loading
  const current = loaded && loaded.userId === userId ? loaded : null;
  return {
    status: current?.status ?? 'loading',
    details: current?.status === 'ready' ? current.details : null,
    retry,
  } as const;
}

/** "4 de mai. de 2023" */
export function formatProfileDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}
