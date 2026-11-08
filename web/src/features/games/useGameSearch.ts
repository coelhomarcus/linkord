import { useEffect, useState } from 'react';
import { ApiError } from '@/shared/api/api';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { searchGames } from './gamesApi';
import type { GameItem } from './types';

export const MIN_QUERY_LENGTH = 2;
// the server's budget is per minute: wait for the typing to stop instead of asking per keystroke
export const SEARCH_DEBOUNCE_MS = 400;
const CACHE_MAX_ENTRIES = 50;

type GameSearchFailure = 'unavailable' | 'busy' | 'failed';
export type GameSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; games: GameItem[] }
  | { status: 'error'; reason: GameSearchFailure };

// Kept for the whole visit: going back to a search already made asks nobody.
const cache = new Map<string, GameItem[]>();
export function clearGameSearchCache(): void { cache.clear(); }
function remember(query: string, games: GameItem[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(query, games);
}

/** What a search is cached and compared by: capitals and spacing make no difference. */
export function normalizeGameQuery(query: string): string {
  return query.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function failureOf(error: unknown): GameSearchFailure {
  if (error instanceof ApiError) return error.status === 503 ? 'unavailable' : error.status === 429 ? 'busy' : 'failed';
  return 'failed';
}

/** Searches IGDB for what is being typed. Asks once typing settles and the text is long enough,
 * cancels the request when the text changes or the component goes away, and ignores a late answer to
 * an older text. `retry` asks again after a failure. */
export function useGameSearch(query: string): GameSearchState & { retry: () => void } {
  const normalized = normalizeGameQuery(query);
  const settled = useDebouncedValue(normalized, SEARCH_DEBOUNCE_MS);
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ query: string; attempt: number; state: GameSearchState } | null>(null);
  const retry = () => setAttempt((value) => value + 1);

  useEffect(() => {
    if (settled.length < MIN_QUERY_LENGTH || cache.has(settled)) return;
    const controller = new AbortController();
    searchGames(settled, controller.signal).then(
      ({ games }) => { remember(settled, games); setOutcome({ query: settled, attempt, state: { status: 'ready', games } }); },
      (error: unknown) => { if (!controller.signal.aborted) setOutcome({ query: settled, attempt, state: { status: 'error', reason: failureOf(error) } }); },
    );
    return () => controller.abort();
  }, [settled, attempt]);

  let state: GameSearchState;
  const cached = cache.get(normalized);
  if (normalized.length < MIN_QUERY_LENGTH) state = { status: 'idle' };
  else if (cached) state = { status: 'ready', games: cached };
  else if (normalized !== settled) state = { status: 'loading' };
  else state = outcome && outcome.query === settled && outcome.attempt === attempt ? outcome.state : { status: 'loading' };
  return { ...state, retry };
}
