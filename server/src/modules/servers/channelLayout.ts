import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { channelPermissionOverwrites, conversations } from '../../db/schema.js';
import { basePermissionsIn, channelPermissionsIn, readServerSnapshot } from './serverAccess.js';
import { hasPermission, PERMISSIONS } from './permissions.js';
import { diffFields, recordServerAudit } from './serverAuditLog.js';
import { lockServer } from './serversRepository.js';

export async function moveServerChannel(
  serverId: string,
  userId: string,
  channelId: string,
  categoryId: string | null,
  target: { channelId: string; edge: 'before' | 'after' } | null,
): Promise<'moved' | 'unchanged' | 'stale' | 'forbidden'> {
  return db.transaction(async (tx) => {
    await lockServer(tx, serverId);
    const snapshot = await readServerSnapshot(serverId, tx);
    const channel = snapshot?.channels.find((item) => item.id === channelId);
    if (!snapshot || !channel) return 'stale';
    if (!hasPermission(basePermissionsIn(snapshot, userId), PERMISSIONS.MANAGE_CHANNELS)
      || !hasPermission(channelPermissionsIn(snapshot, channelId, userId), PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.MANAGE_CHANNELS)) return 'forbidden';

    const category = snapshot.categories.find((item) => item.id === categoryId);
    if (categoryId !== null && !category) return 'stale';

    const siblings = snapshot.channels
      .filter((item) => item.categoryId === categoryId && item.type === channel.type)
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const ordered = siblings.filter((item) => item.id !== channelId);
    const anchorIndex = target ? ordered.findIndex((item) => item.id === target.channelId) : -1;
    if (target && (anchorIndex < 0 || !hasPermission(channelPermissionsIn(snapshot, target.channelId, userId), PERMISSIONS.VIEW_CHANNEL))) {
      return 'stale';
    }
    ordered.splice(target ? anchorIndex + Number(target.edge === 'after') : ordered.length, 0, channel);
    const categoryChanged = channel.categoryId !== categoryId;
    if (!categoryChanged && siblings.every((item, index) => item.id === ordered[index]?.id)) return 'unchanged';

    // A layout change preserves access. Pull the inherited rules onto the channel
    // before detaching it from its old category.
    const detach = categoryChanged && channel.permissionsSynced;
    if (detach && channel.categoryId) {
      await tx.delete(channelPermissionOverwrites).where(eq(channelPermissionOverwrites.channelId, channelId));
      const inherited = snapshot.overwrites.get(channel.categoryId) ?? [];
      if (inherited.length) {
        await tx.insert(channelPermissionOverwrites).values(inherited.map((rule) => ({
          ...rule, id: crypto.randomUUID(), serverId, channelId, categoryId: null,
        })));
      }
    }
    for (const [position, item] of ordered.entries()) {
      if (item.id === channelId) {
        await tx.update(conversations).set({ categoryId, position, ...(detach ? { permissionsSynced: false } : {}) })
          .where(eq(conversations.id, channelId));
      } else if (item.position !== position) {
        await tx.update(conversations).set({ position }).where(eq(conversations.id, item.id));
      }
    }
    const previousCategory = snapshot.categories.find((item) => item.id === channel.categoryId);
    const changes = diffFields(
      { category: previousCategory?.name ?? null, position: channel.position },
      { category: category?.name ?? null, position: ordered.indexOf(channel) },
      ['category', 'position'],
    );
    await recordServerAudit(tx, { serverId, actorId: userId, action: 'channel.update', targetType: 'channel', targetId: channelId, targetLabel: channel.title, changes });
    return 'moved';
  });
}
