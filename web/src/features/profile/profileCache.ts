import { fetchProfileDetails, fetchUserProfile } from '@/shared/api/api';
import type { ProfileDetails, SocialUser } from '@/shared/api/api';
import type { PublicUser } from '@/shared/types/protocol';
import { createResourceCache, useResource } from '@/shared/lib/resourceCache';
import { fetchWall } from './profileApi';
import type { WallResponse } from './connectionsTypes';

// One cache per resource, shared by the mini profile, the modal and the panel
// beside a DM: a profile seen once opens at once next time, and is read again
// behind it (stale-while-revalidate).

/** Profiles of accounts outside the room's known users (`allUsers`). */
const userProfiles = createResourceCache<PublicUser>((userId) => fetchUserProfile(userId).then(({ user }) => user));

export const profileDetails = createResourceCache<ProfileDetails>((userId, signal) => fetchProfileDetails(userId, signal));

const OWN_WALL = 'me:';
/** Your own Wall (with what could be added) is another resource than the one visitors see. */
export const wallKey = (userId: string, owner: boolean) => (owner ? `${OWN_WALL}${userId}` : userId);
export const walls = createResourceCache<WallResponse>((key, signal) => (
  key.startsWith(OWN_WALL) ? fetchWall(key.slice(OWN_WALL.length), true, signal) : fetchWall(key, false, signal)
), { max: 50 });

/** What a list row already knows about someone (name, avatar), so their profile
 * can open with it while the rest is read. Never replaces a full profile. */
export function rememberProfilePreview(user: SocialUser): void {
  userProfiles.seed(user.id, { ...user, banner: '', bio: '', profileLinks: [], role: 'user' });
}

/** A deleted account: nothing of it stays to be shown. */
export function forgetProfile(userId: string): void {
  userProfiles.delete(userId);
  profileDetails.delete(userId);
  walls.delete(userId);
}

/** A profile outside the room's known users, read when `userId` is set. */
export function useUserProfile(userId: string | null) {
  return useResource(userProfiles, userId);
}
