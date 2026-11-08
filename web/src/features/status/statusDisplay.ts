import { useRoom } from '@/state/RoomContext';
import type { CustomStatus, PresenceStatus } from '@/shared/types/protocol';

/** What a dot shows. `invisible` only ever describes yourself; to everyone else you are `offline`. */
export type DisplayStatus = PresenceStatus | 'offline';

export const STATUS_CHOICES = ['online', 'idle', 'dnd', 'invisible'] as const satisfies readonly PresenceStatus[];

export const EXPIRY_CHOICES = ['30m', '1h', '4h', 'today', 'never'] as const;
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number];

const EXPIRY_MS: Record<Exclude<ExpiryChoice, 'today' | 'never'>, number> = {
  '30m': 30 * 60_000, '1h': 60 * 60_000, '4h': 4 * 60 * 60_000,
};

/** The ISO time a custom status set now stops showing. "Today" ends at the next local midnight, which
 * only the browser knows; that is why the client sends a time instead of a choice. */
export function expiresAtFor(choice: ExpiryChoice, now = new Date()): string | null {
  if (choice === 'never') return null;
  if (choice === 'today') {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.toISOString();
  }
  return new Date(now.getTime() + EXPIRY_MS[choice]).toISOString();
}

/** The server clears an expired status and says so; this only hides one in the moments in between. */
export function liveCustomStatus(custom: CustomStatus | null | undefined, now = Date.now()): CustomStatus | null {
  if (!custom) return null;
  return custom.expiresAt && Date.parse(custom.expiresAt) <= now ? null : custom;
}

/** Someone's status as this account sees it; for the account itself, its own (automatic idle included). */
export function useUserStatus(userId: string | null | undefined): DisplayStatus {
  const { state, onlineUserIds, presenceByUser, ownStatus } = useRoom();
  if (!userId) return 'offline';
  if (userId === state.me.userId) return ownStatus.effective;
  if (!onlineUserIds.has(userId)) return 'offline';
  return presenceByUser.get(userId)?.status ?? 'online';
}

export function useCustomStatus(userId: string | null | undefined): CustomStatus | null {
  const { state, onlineUserIds, presenceByUser, ownStatus } = useRoom();
  if (!userId) return null;
  if (userId === state.me.userId) return liveCustomStatus(ownStatus.customStatus);
  if (!onlineUserIds.has(userId)) return null;
  return liveCustomStatus(presenceByUser.get(userId)?.customStatus);
}
