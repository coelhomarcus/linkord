import { inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations } from '../../db/schema.js';

// Leaf module (db/schema only): messages.ts serializes history with it and
// callInvites.ts builds the live card with it, without the two importing each other.

/** What a `call_invite` card shows about the group whose call it points at.
 * Who is in the call right now is not stored: the client reads it from presence. */
export interface CallInviteCard {
  groupId: string;
  groupTitle: string;
  groupAvatar: string;
}

/** One batched read for every card on a history page. A group that no longer
 * exists (or was suspended) is absent from the map: the caller renders the tombstone. */
export async function loadCallInviteCards(groupIds: string[]): Promise<Map<string, CallInviteCard>> {
  const cards = new Map<string, CallInviteCard>();
  const ids = [...new Set(groupIds)];
  if (!ids.length) return cards;
  const rows = await db
    .select({ id: conversations.id, title: conversations.title, avatar: conversations.avatar, status: conversations.status })
    .from(conversations)
    .where(inArray(conversations.id, ids));
  for (const r of rows) {
    if (r.status === 'active') cards.set(r.id, { groupId: r.id, groupTitle: r.title, groupAvatar: r.avatar });
  }
  return cards;
}
