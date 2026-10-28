import { useEffect, useRef, useState } from 'react';

import { fetchMedia, ApiError } from '@/shared/api/api';
import type { MediaItem, MediaKind } from '@/shared/api/api';

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Não foi possível carregar.');

/** One list of the media modal: the first page for the tab and search, then
 * further pages on demand. Changing the tab, the search or the conversation
 * starts over. */
export function useMediaFeed({ open, conversationId, kind, q }: {
  open: boolean;
  conversationId: string | null;
  kind: MediaKind;
  q: string;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  // true from the start: the first load only begins in an effect, after a
  // render that would otherwise flash the "nothing here yet" state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The previous request's rows are dropped while rendering, not in an effect,
  // so a stale list never paints for a frame under the new conversation, tab
  // or search. Closing keeps them: the modal is still on screen while it
  // animates out.
  const requestKey = `${open}|${conversationId}|${kind}|${q}`;
  const [seenRequestKey, setSeenRequestKey] = useState(requestKey);
  if (seenRequestKey !== requestKey) {
    setSeenRequestKey(requestKey);
    if (open && conversationId) {
      setItems([]);
      setNextBefore(null);
      setError(null);
      setLoading(true);
    }
  }

  // A response that lands after the request changed would replace or extend
  // the rows of the new one.
  const currentKey = useRef(requestKey);
  useEffect(() => { currentKey.current = requestKey; }, [requestKey]);

  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    fetchMedia(kind, null, conversationId, q)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextBefore(page.nextBefore);
      })
      .catch((err) => { if (!cancelled) setError(errorMessage(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, conversationId, kind, q]);

  async function loadMore() {
    if (!conversationId) return;
    const key = currentKey.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMedia(kind, nextBefore, conversationId, q);
      if (currentKey.current !== key) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextBefore(page.nextBefore);
    } catch (err) {
      if (currentKey.current === key) setError(errorMessage(err));
    } finally {
      if (currentKey.current === key) setLoading(false);
    }
  }

  return { items, hasMore: nextBefore != null, loading, error, loadMore };
}
