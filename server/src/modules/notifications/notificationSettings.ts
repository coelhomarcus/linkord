import { and, eq, isNotNull, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notificationSettings, type NotificationSettingRow } from '../../db/schema.js';
import { getConversationForUser } from '../conversations/conversationsRepository.js';
import { loadServerSnapshot } from '../servers/serverAccess.js';
import { sendToUser } from '../presence/participants.js';
import {
  applyNotificationChange, isDefaultSetting, isMutedNow, resolveNotificationPolicy,
  type NotificationLevel, type NotificationPolicy, type NotificationSetting, type NotificationSettingChange,
} from './notificationSettingsPolicy.js';

export type NotificationScope = 'server' | 'conversation';

/** On the wire: `mutedUntil` as an ISO string. An expired mute is sent as no mute at all. */
export interface WireNotificationSetting { level: NotificationLevel | null; muted: boolean; mutedUntil: string | null }

export interface WireNotificationSettings {
  servers: Record<string, WireNotificationSetting>;
  conversations: Record<string, WireNotificationSetting>;
}

function toSetting(row: Pick<NotificationSettingRow, 'level' | 'muted' | 'mutedUntil'>): NotificationSetting {
  return { level: (row.level as NotificationLevel | null) ?? null, muted: row.muted, mutedUntil: row.mutedUntil };
}

function toWire(setting: NotificationSetting, now: Date): WireNotificationSetting | null {
  if (isDefaultSetting(setting, now)) return null;
  const muted = isMutedNow(setting, now);
  return { level: setting.level, muted, mutedUntil: muted && setting.mutedUntil ? setting.mutedUntil.toISOString() : null };
}

/** Everything the account changed, for the welcome and for GET. */
export async function listNotificationSettings(userId: string, now = new Date()): Promise<WireNotificationSettings> {
  const rows = await db.select().from(notificationSettings).where(eq(notificationSettings.userId, userId));
  const out: WireNotificationSettings = { servers: {}, conversations: {} };
  for (const row of rows) {
    const wire = toWire(toSetting(row), now);
    if (!wire) continue;
    if (row.serverId) out.servers[row.serverId] = wire;
    else if (row.conversationId) out.conversations[row.conversationId] = wire;
  }
  return out;
}

/** What one message in this conversation may do for this reader (push delivery). One query. */
export async function notificationPolicyFor(userId: string, conversation: { id: string; serverId: string | null }, now = new Date()): Promise<NotificationPolicy> {
  const rows = await db.select().from(notificationSettings).where(and(
    eq(notificationSettings.userId, userId),
    conversation.serverId
      ? or(eq(notificationSettings.conversationId, conversation.id), eq(notificationSettings.serverId, conversation.serverId))
      : eq(notificationSettings.conversationId, conversation.id),
  ));
  const own = rows.find((row) => row.conversationId === conversation.id);
  const server = rows.find((row) => row.serverId !== null);
  return resolveNotificationPolicy({ conversation: own ? toSetting(own) : null, server: server ? toSetting(server) : null }, now);
}

/** A server the account is in, or a text channel or DM it can read. Voice channels have no unread state to tune. */
async function canTune(userId: string, scope: NotificationScope, id: string): Promise<boolean> {
  if (scope === 'server') {
    const snapshot = await loadServerSnapshot(id);
    return !!snapshot && snapshot.members.has(userId);
  }
  const conversation = await getConversationForUser(id, userId);
  return !!conversation && conversation.type !== 'voice';
}

const scopeColumn = (scope: NotificationScope) => (scope === 'server' ? notificationSettings.serverId : notificationSettings.conversationId);

/** Applies one change and tells every tab of the account. Returns 'not_found' for something the account
 * cannot see, so a guessed id says nothing about whether it exists. */
export async function updateNotificationSetting(
  userId: string, scope: NotificationScope, id: string, change: NotificationSettingChange, now = new Date(),
): Promise<WireNotificationSetting | null | 'not_found'> {
  if (!(await canTune(userId, scope, id))) return 'not_found';
  const column = scopeColumn(scope);
  const where = and(eq(notificationSettings.userId, userId), eq(column, id));
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(notificationSettings).where(where).limit(1).for('update');
    const next = applyNotificationChange(current ? toSetting(current) : null, change, now);
    if (isDefaultSetting(next, now)) {
      if (current) await tx.delete(notificationSettings).where(where);
      return null;
    }
    const values = { level: next.level, muted: next.muted, mutedUntil: next.mutedUntil, updatedAt: now };
    await tx.insert(notificationSettings)
      .values({ userId, ...(scope === 'server' ? { serverId: id } : { conversationId: id }), ...values })
      .onConflictDoUpdate({ target: [notificationSettings.userId, column], targetWhere: isNotNull(column), set: values });
    return next;
  });
  const wire = result ? toWire(result, now) : null;
  sendToUser(userId, { t: 'notification-settings', scope, id, setting: wire });
  return wire;
}
