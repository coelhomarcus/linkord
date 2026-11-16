import { useRoom, useRoomState } from '@/state/RoomContext';
import type { Activity } from '@/shared/types/protocol';

/** What someone is playing or using, as this account may see it; for the account itself, its own as others see it. */
export function useUserActivity(userId: string | null | undefined): Activity | null {
  const { onlineUserIds, presenceByUser, ownStatus } = useRoom('onlineUserIds', 'presenceByUser', 'ownStatus');
  const state = useRoomState('me');
  if (!userId) return null;
  if (userId === state.me.userId) return ownStatus.activity ?? null;
  if (!onlineUserIds.has(userId)) return null;
  return presenceByUser.get(userId)?.activity ?? null;
}
