import { useRoomSelector } from '@/state/RoomContext';
import type { Activity } from '@/shared/types/protocol';

/** What someone is playing or using, as this account may see it; for the account itself, its own as others see it.
 * A selector, so a row re-renders only when this person's activity changes, not anyone else's. */
export function useUserActivity(userId: string | null | undefined): Activity | null {
  return useRoomSelector((room) => {
    if (!userId) return null;
    if (userId === room.state.me.userId) return room.ownStatus.activity ?? null;
    if (!room.onlineUserIds.has(userId)) return null;
    return room.presenceByUser.get(userId)?.activity ?? null;
  });
}
