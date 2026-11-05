import { inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serverInvitations, servers } from '../../db/schema.js';

// Leaf module (db/schema only): messages.ts needs the card payload to
// serialize history, and serverInvitationsRepository.ts needs messages'
// consumers — keeping the shared pieces here stops the two from importing
// each other.

type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

// `expired` is legacy: invitations no longer lapse, but rows from before that
// keep the state they had.

/** Everything the card in a DM may show BEFORE the person joins — server
 * name and icon, member COUNT, who invited. Never the member list,
 * channels or messages. */
export interface InvitationCard {
  id: string;
  status: InvitationStatus;
  serverId: string;
  serverName: string;
  serverIcon: string;
  memberCount: number;
  inviterId: string;
  inviteeId: string;
  version: number;
}

/** One batched read for any number of invitations — history pages carry many
 * cards and must not cost a query each. A missing id (invitation deleted with
 * its server) is simply absent from the map: the caller renders the tombstone. */
export async function loadInvitationCards(ids: string[]): Promise<Map<string, InvitationCard>> {
  const cards = new Map<string, InvitationCard>();
  if (!ids.length) return cards;
  const rows = await db
    .select({
      id: serverInvitations.id, status: serverInvitations.status,
      serverId: serverInvitations.serverId, inviterId: serverInvitations.inviterId,
      inviteeId: serverInvitations.inviteeId, version: serverInvitations.version,
      serverName: servers.name, serverIcon: servers.icon,
      memberCount: sql<number>`(select count(*)::int from server_members m where m.server_id = ${serverInvitations.serverId})`,
    })
    .from(serverInvitations)
    .innerJoin(servers, sql`${servers.id} = ${serverInvitations.serverId}`)
    .where(inArray(serverInvitations.id, ids));
  for (const r of rows) {
    cards.set(r.id, {
      id: r.id, status: r.status as InvitationStatus, serverId: r.serverId, serverName: r.serverName, serverIcon: r.serverIcon,
      memberCount: r.memberCount, inviterId: r.inviterId, inviteeId: r.inviteeId, version: r.version,
    });
  }
  return cards;
}
