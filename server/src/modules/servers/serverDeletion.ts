import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, servers } from '../../db/schema.js';
import { refreshKnownPeers } from '../presence/knownPeers.js';
import { deleteAvatarFile, deleteForServer } from '../attachments/attachmentCleanup.js';
import { revokeCallAccess } from '../calls/callAccess.js';
import { invalidateServer } from './serverAccess.js';
import { serverMemberIds } from './serversRepository.js';
import { sendServerRemoved } from './serverSummaries.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'servers' });

/** Deletes a server for good — files first (the rows that name them go with
 * the server), then the server and everything cascading from it, then tells
 * every member and cuts their calls. Shared by the owner's "delete server",
 * the last member leaving and the administrative delete; the caller has
 * already authorized it. Returns null when there is no such server. */
export async function deleteServerCompletely(serverId: string): Promise<{ memberIds: string[]; name: string } | null> {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return null;
  const [memberIds, voiceChannels] = await Promise.all([
    serverMemberIds(serverId),
    db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.serverId, serverId), eq(conversations.type, 'voice'))),
  ]);
  await deleteForServer(serverId);
  await db.delete(servers).where(eq(servers.id, serverId));
  invalidateServer(serverId);
  if (server.icon) deleteAvatarFile(server.icon).catch((err) => log.error('failed to delete server icon', err, { serverId }));
  for (const userId of memberIds) {
    sendServerRemoved(userId, serverId, 'deleted');
    for (const channel of voiceChannels) void revokeCallAccess(userId, channel.id);
  }
  await refreshKnownPeers(memberIds);
  return { memberIds, name: server.name };
}
