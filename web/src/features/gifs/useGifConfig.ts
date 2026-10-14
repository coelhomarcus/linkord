import { useEffect, useState } from 'react';
import { fetchGifConfig } from '@/shared/api/api';
import type { GifConfig } from '@/shared/api/api';
import { useRoom } from '@/state/RoomContext';

// One read per account and page load: every composer asks, only the first fetches.
let cached: { userId: string; promise: Promise<GifConfig> } | null = null;

function loadFor(userId: string): Promise<GifConfig> {
  if (cached?.userId !== userId) {
    const promise = fetchGifConfig().catch((): GifConfig => {
      cached = null; // a failed read is retried by the next composer, not remembered
      return { enabled: false };
    });
    cached = { userId, promise };
  }
  return cached.promise;
}

/** null while unknown; `{ enabled: false }` when the server has no KLIPY key. */
export function useGifConfig(): GifConfig | null {
  const { state } = useRoom();
  const userId = state.me.userId;
  const [config, setConfig] = useState<{ userId: string; value: GifConfig } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadFor(userId).then((value) => { if (!cancelled) setConfig({ userId, value }); });
    return () => { cancelled = true; };
  }, [userId]);

  return config && config.userId === userId ? config.value : null;
}
