import { areFriends } from '../friendships/friendshipsRepository.js';
import { shareAnyConversation } from '../conversations/conversationsRepository.js';

export async function canViewProfile(viewerId: string, viewerRole: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId || viewerRole === 'admin') return true;
  if (await areFriends(viewerId, targetId)) return true;
  return shareAnyConversation(viewerId, targetId);
}
