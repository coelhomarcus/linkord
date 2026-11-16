import { useRoom } from '@/state/RoomContext';
import type { Activity } from '@/shared/types/protocol';

/** What someone is playing or using, as this account may see it; for the account itself, its own as others see it. */
export function useUserActivity(userId: string | null | undefined): Activity | null {
  const { state, onlineUserIds, presenceByUser, ownStatus } = useRoom();
  if (!userId) return null;
  if (userId === state.me.userId) return ownStatus.activity ?? null;
  if (!onlineUserIds.has(userId)) return null;
  return presenceByUser.get(userId)?.activity ?? null;
}
