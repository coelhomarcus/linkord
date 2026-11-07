import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { callPresence, users } from '../../db/schema.js';
import { resolveDisplayName } from '../users/users.js';
import type { CallPresenceStore, RestorableCallParticipant } from './participants.js';

/** Upserts while the connection is in a call, removes the row once it is not. */
async function save(participantId: string, token: string, userId: string, conversationId: string | null, deafened: boolean): Promise<void> {
  if (!conversationId) {
    await db.delete(callPresence).where(eq(callPresence.participantId, participantId));
    return;
  }
  await db.insert(callPresence)
    .values({ participantId, token, userId, conversationId, deafened })
    .onConflictDoUpdate({
      target: callPresence.participantId,
      set: { conversationId, deafened, updatedAt: new Date() },
    });
}

export const callPresenceStore: CallPresenceStore = {
  save: (p) => save(p.id, p.token, p.userId, p.callConversationId, p.deafened),
  remove: async (participantId) => {
    await db.delete(callPresence).where(eq(callPresence.participantId, participantId));
  },
};

export async function loadCallPresence(): Promise<RestorableCallParticipant[]> {
  const rows = await db.select({ presence: callPresence, user: users })
    .from(callPresence)
    .innerJoin(users, eq(users.id, callPresence.userId));
  return rows.map(({ presence, user }) => ({
    id: presence.participantId,
    token: presence.token,
    conversationId: presence.conversationId,
    deafened: presence.deafened,
    profile: {
      userId: user.id,
      username: user.username,
      displayName: resolveDisplayName(user.displayName, user.username),
      avatar: user.avatar,
      avatarPoster: user.avatarPoster,
      avatarColor: user.avatarColor,
      banner: user.banner,
      bannerPoster: user.bannerPoster,
      bio: user.bio,
      profileLinks: user.profileLinks,
      role: user.role === 'admin' ? 'admin' : 'user',
    },
  }));
}
