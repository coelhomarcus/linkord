import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, servers } from '../../db/schema.js';

// Leaf module (db/schema only): messages.ts serializes history with it and
// callInvites.ts builds the live card with it, without the two importing each other.

/** What a `call_invite` card shows about the voice channel whose call it
 * points at. Who is in the call right now is not stored: the client reads it
 * from presence. */
export interface CallInviteCard {
  channelId: string;
  channelName: string;
  serverId: string;
  serverName: string;
  serverIcon: string;
}

/** One batched read for every card on a history page. A channel that no
 * longer exists (or whose server was suspended) is absent from the map: the
 * caller renders the tombstone. */
export async function loadCallInviteCards(channelIds: string[]): Promise<Map<string, CallInviteCard>> {
  const cards = new Map<string, CallInviteCard>();
  const ids = [...new Set(channelIds)];
  if (!ids.length) return cards;
  const rows = await db
    .select({ id: conversations.id, name: conversations.title, serverId: servers.id, serverName: servers.name, serverIcon: servers.icon, status: servers.status })
    .from(conversations)
    .innerJoin(servers, eq(servers.id, conversations.serverId))
    .where(inArray(conversations.id, ids));
  for (const r of rows) {
    if (r.status === 'active') cards.set(r.id, { channelId: r.id, channelName: r.name, serverId: r.serverId, serverName: r.serverName, serverIcon: r.serverIcon });
  }
  return cards;
}
