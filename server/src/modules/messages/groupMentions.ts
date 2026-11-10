import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { webhooks } from '../../db/schema.js';
import { messageMentions } from '../link-preview/messageLinks.js';
import { channelPermissionsIn, loadServerSnapshot } from '../servers/serverAccess.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';

// @everyone, @here and role mentions. The text always goes out as written;
// what is decided here is whether it notifies anyone, Discord's way:
// @everyone and @here take MENTION_EVERYONE in the channel, and a role
// takes either that or the role's own "mentionable". Decided once, when the
// message is sent or edited, and stored on it (messages.mention_everyone,
// mention_role_ids), so a reader never highlights a message that pinged
// nobody and a later change of permissions does not rewrite history.

export interface GroupMentions {
  everyone: boolean;
  here: boolean;
  /** roles of the channel's server, never @everyone's own */
  roleIds: string[];
}

export const NO_GROUP_MENTIONS: GroupMentions = { everyone: false, here: false, roleIds: [] };

export interface MentionableRole {
  id: string;
  isDefault: boolean;
  mentionable: boolean;
}

/** The groups `text` names that its author may notify. */
export function allowedGroupMentions(text: string, roles: readonly MentionableRole[], canMentionEveryone: boolean): GroupMentions {
  const named = messageMentions(text);
  const byId = new Map(roles.map((role) => [role.id, role]));
  return {
    everyone: named.everyone && canMentionEveryone,
    here: named.here && canMentionEveryone,
    roleIds: named.roleIds.filter((id) => {
      const role = byId.get(id);
      return !!role && !role.isDefault && (role.mentionable || canMentionEveryone);
    }),
  };
}

export type MentionAuthor = { userId: string } | { webhookId: string };

/** The groups a message in `conversation` notifies. A DM has no groups. A
 * webhook holds MENTION_EVERYONE when the account that created it still
 * does in that channel: a leaked URL is worth no more than its creator. */
export async function resolveGroupMentions(conversation: { id: string; serverId: string | null }, text: string, author: MentionAuthor): Promise<GroupMentions> {
  if (!conversation.serverId || !text.includes('@')) return NO_GROUP_MENTIONS;
  const snapshot = await loadServerSnapshot(conversation.serverId);
  if (!snapshot) return NO_GROUP_MENTIONS;
  let actorId: string | null;
  if ('userId' in author) actorId = author.userId;
  else {
    const [webhook] = await db.select({ createdBy: webhooks.createdBy }).from(webhooks).where(eq(webhooks.id, author.webhookId)).limit(1);
    actorId = webhook?.createdBy ?? null;
  }
  const granted = actorId ? channelPermissionsIn(snapshot, conversation.id, actorId) : 0;
  return allowedGroupMentions(text, snapshot.roles, hasPermission(granted, PERMISSIONS.MENTION_EVERYONE));
}

/** How a message stores what it notified. */
export function groupMentionColumns(groups: GroupMentions): { mentionEveryone: boolean; mentionRoleIds: string[] | null } {
  return { mentionEveryone: groups.everyone || groups.here, mentionRoleIds: groups.roleIds.length ? groups.roleIds : null };
}

/** Who the groups reach among the channel's `viewers`: all of them for
 * @everyone, the ones online for @here, the holders of a mentioned role. */
export function groupMentionRecipients(
  viewers: readonly string[],
  groups: GroupMentions,
  roleIdsOf: (userId: string) => readonly string[],
  isOnline: (userId: string) => boolean,
): string[] {
  if (groups.everyone) return [...viewers];
  const roles = new Set(groups.roleIds);
  if (!groups.here && !roles.size) return [];
  return viewers.filter((userId) => (groups.here && isOnline(userId)) || roleIdsOf(userId).some((id) => roles.has(id)));
}
