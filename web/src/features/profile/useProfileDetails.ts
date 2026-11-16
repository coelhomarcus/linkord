import { useResource } from '@/shared/lib/resourceCache';
import { useOptionalRoomSelector } from '@/state/RoomContext';
import { profileDetails } from './profileCache';

/** The member-since date, friends-since date and what the caller has in common
 * with `userId`. A copy read before renders at once and is read again on every
 * open and every social change (friends and groups change). */
export function useProfileDetails(userId: string | null) {
  const socialRevision = useOptionalRoomSelector((room) => room.socialRevision);
  const { status, value, retry } = useResource(profileDetails, userId, socialRevision);
  return { status, details: value ?? null, retry } as const;
}

/** "4 de mai. de 2023" */
export function formatProfileDate(iso: string, language: string): string {
  return new Date(iso).toLocaleDateString(language, { day: 'numeric', month: 'short', year: 'numeric' });
}
