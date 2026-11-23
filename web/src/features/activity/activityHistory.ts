import { createResourceCache, useResource } from '@/shared/lib/resourceCache';
import { fetchActivityHistory, fetchOwnActivityHistory } from './activityApi';
import { useUserActivity } from './activityDisplay';

/** Someone's recent games and apps, shared by whatever shows them: seen once, they open at once next time. */
export const activityHistories = createResourceCache((userId, signal) => fetchActivityHistory(userId, signal), { max: 50 });

/** `userId`'s history, read again when what they are doing now changes: the game that just ended joins the list. */
export function useActivityHistory(userId: string | null) {
  const current = useUserActivity(userId);
  return useResource(activityHistories, userId, current ? `${current.key}@${current.startedAt}` : null);
}

/** This account's own games and apps, hidden ones too, for its activity settings; keyed by its id. */
export const ownActivityHistories = createResourceCache((_userId, signal) => fetchOwnActivityHistory(signal), { max: 1 });
