import { areFriends } from '../friendships/friendshipsRepository.js';
import { isBlocked } from '../blocks/blocksRepository.js';
import { shareAnyConversation } from '../conversations/conversationsRepository.js';

/** A block by the target hides the profile even where the two still share a
 * server or an old DM. A block by the viewer does not: the blocker's view of
 * that profile is where they find "Unblock". */
export async function canViewProfile(viewerId: string, viewerRole: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId || viewerRole === 'admin') return true;
  if (await isBlocked(targetId, viewerId)) return false;
  if (await areFriends(viewerId, targetId)) return true;
  return shareAnyConversation(viewerId, targetId);
}
