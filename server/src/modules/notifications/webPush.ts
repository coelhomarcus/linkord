import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import webPush from 'web-push';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { channelReadStates, conversationMembers, conversations, friendships, messages, notifications, pushDeliveryReceipts, pushSubscriptions, serverInvitations, servers, users, webhooks, type Conversation, type OutboxEvent } from '../../db/schema.js';
import { getConversationForUser } from '../conversations/conversationsRepository.js';
import { logger } from '../../lib/logger.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { resolveLocale, type Locale } from '../users/locale.js';
import { localeText } from '../users/localeText.js';
import { formatCallLength } from '../calls/callLength.js';

const log = logger.child({ component: 'web-push' });

export const pushAvailable = !!config.PUSH_VAPID_PUBLIC_KEY;
if (pushAvailable) webPush.setVapidDetails(config.PUSH_VAPID_SUBJECT, config.PUSH_VAPID_PUBLIC_KEY, config.PUSH_VAPID_PRIVATE_KEY);

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Browser-provided endpoints still cross an authenticated, user-controlled API.
// Restrict destinations before the server makes any outbound request.
export function validPushSubscription(value: unknown): value is BrowserPushSubscription {
  if (!value || typeof value !== 'object') return false;
  const sub = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof sub.endpoint !== 'string' || sub.endpoint.length > 2048) return false;
  let url: URL;
  try { url = new URL(sub.endpoint); } catch { return false; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  if (!(host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com'))) return false;
  const key = /^[A-Za-z0-9_-]+={0,2}$/;
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string'
    || !key.test(sub.keys.p256dh) || !key.test(sub.keys.auth)) return false;
  const publicKey = Buffer.from(sub.keys.p256dh, 'base64url');
  return publicKey.length === 65 && publicKey[0] === 4 && Buffer.from(sub.keys.auth, 'base64url').length === 16;
}

export async function savePushSubscription(userId: string, sub: BrowserPushSubscription): Promise<void> {
  await db.insert(pushSubscriptions).values({
    endpoint: sub.endpoint, userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth,
  }).onConflictDoUpdate({
    target: pushSubscriptions.endpoint,
    set: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, updatedAt: new Date() },
  });
}

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

interface PushNotice { title: string; body: string; path: string; tag: string }

interface PushDeliveryResult { delivered: boolean; retryAfterMs: number }

export function retryAfterDelayMs(headers: unknown, now = Date.now()): number {
  if (!headers || typeof headers !== 'object') return 0;
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after');
  const raw = Array.isArray(entry?.[1]) ? entry[1][0] : entry?.[1];
  if (typeof raw !== 'string') return 0;
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) ? delay : 0;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

/** Where a tap on the notification takes the reader. */
function conversationPath(conversation: Pick<Conversation, 'id' | 'serverId'>): string {
  return conversation.serverId
    ? `/app/channels/${encodeURIComponent(conversation.serverId)}/${encodeURIComponent(conversation.id)}`
    : `/app/channels/@me/${encodeURIComponent(conversation.id)}`;
}

async function lastReadMessageId(conversation: Conversation, userId: string): Promise<number> {
  const [row] = conversation.serverId
    ? await db.select({ id: channelReadStates.lastReadMessageId }).from(channelReadStates)
      .where(and(eq(channelReadStates.channelId, conversation.id), eq(channelReadStates.userId, userId))).limit(1)
    : await db.select({ id: conversationMembers.lastReadMessageId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, userId))).limit(1);
  return row?.id ?? 0;
}

async function noticeFor(event: OutboxEvent, locale: Locale): Promise<PushNotice | null> {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'chat_message_push') {
    if (!Number.isSafeInteger(payload.messageId)) return null;
    const [row] = await db.select({ message: messages, author: users, webhookName: webhooks.name, serverName: servers.name })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .leftJoin(servers, eq(servers.id, conversations.serverId))
      .leftJoin(users, eq(users.id, messages.authorId))
      .leftJoin(webhooks, eq(webhooks.id, messages.webhookId))
      .where(eq(messages.id, payload.messageId as number)).limit(1);
    // re-checked at delivery: the reader may have lost the channel since
    const conversation = row ? await getConversationForUser(row.message.conversationId, event.audienceUserId) : null;
    if (!row || !conversation || (await lastReadMessageId(conversation, event.audienceUserId)) >= row.message.id) return null;
    if (conversation.type === 'direct' && row.message.authorId
      && !(await canSendDirectMessage(row.message.authorId, event.audienceUserId))) return null;
    const [mention] = await db.select({ id: notifications.id }).from(notifications).where(and(
      eq(notifications.recipientId, event.audienceUserId), eq(notifications.kind, 'mention'),
      eq(notifications.messageId, row.message.id), isNull(notifications.readAt),
    )).limit(1);
    if (mention) return null;
    const name = row.author ? row.author.displayName || row.author.username : row.message.webhookId ? row.webhookName || 'Bot' : 'Alguém';
    const text = row.message.text.replace(/\s+/g, ' ').trim().slice(0, 120);
    const title = conversation.type === 'direct' ? name : `#${conversation.title} · ${row.serverName ?? ''}`;
    const path = conversationPath(conversation);
    if (row.message.kind === 'dm_call') {
      const duration = row.message.callDurationSeconds;
      const body = duration == null
        ? localeText(locale, 'push.dmCall', { name })
        : localeText(locale, 'push.dmCallLasted', { name, duration: formatCallLength(duration, locale) });
      return { title, body, path, tag: `chat-${conversation.id}` };
    }
    if (row.message.kind === 'call_invite' && row.message.callConversationId) {
      const [channel] = await db.select({ name: conversations.title, serverName: servers.name }).from(conversations)
        .innerJoin(servers, eq(servers.id, conversations.serverId))
        .where(eq(conversations.id, row.message.callConversationId)).limit(1);
      if (channel) {
        return { title, body: localeText(locale, 'push.callInviteBody', { name, channel: channel.name, server: channel.serverName }), path, tag: `chat-${conversation.id}` };
      }
    }
    return { title, body: text ? `${name}: ${text}` : localeText(locale, 'push.chatEmptyBody', { name }), path, tag: `chat-${conversation.id}` };
  }

  const kind = event.type === 'friend_request_created' ? 'friend_request'
    : event.type === 'friend_request_accepted' ? 'friend_accepted'
      : event.type === 'server_invitation_created' ? 'server_invitation'
        : event.type === 'mention_created' ? 'mention' : null;
  if (!kind) return null;
  const reference = kind === 'mention' ? payload.messageId : kind === 'server_invitation' ? payload.invitationId : payload.friendshipId;
  if (typeof reference !== 'string' && typeof reference !== 'number') return null;
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.recipientId, event.audienceUserId), eq(notifications.kind, kind), isNull(notifications.readAt),
    kind === 'mention' ? eq(notifications.messageId, Number(reference))
      : kind === 'server_invitation' ? eq(notifications.serverInvitationId, String(reference))
        : eq(notifications.friendshipId, String(reference)),
  )).limit(1);
  if (!row) return null;
  if (kind === 'mention') {
    const [message] = await db.select({ conversationId: messages.conversationId, authorId: messages.authorId })
      .from(messages).where(eq(messages.id, Number(reference))).limit(1);
    const conversation = message ? await getConversationForUser(message.conversationId, event.audienceUserId) : null;
    if (!message || !conversation) return null;
    if (conversation.type === 'direct' && message.authorId
      && !(await canSendDirectMessage(message.authorId, event.audienceUserId))) return null;
    return { title: localeText(locale, 'push.mentionedTitle'), body: localeText(locale, 'push.mentionedBody'),
      path: conversationPath(conversation), tag: `mention-${row.id}` };
  }
  if (kind === 'server_invitation') {
    const [invitation] = await db.select({ status: serverInvitations.status }).from(serverInvitations).where(eq(serverInvitations.id, String(reference))).limit(1);
    if (!invitation || invitation.status !== 'pending') return null;
    return { title: localeText(locale, 'push.serverInvitationTitle'), body: localeText(locale, 'push.serverInvitationBody'), path: '/app/friends?tab=invitations', tag: `social-${row.id}` };
  }
  const [friendship] = await db.select({ status: friendships.status }).from(friendships).where(eq(friendships.id, String(reference))).limit(1);
  if (!friendship || friendship.status !== (kind === 'friend_request' ? 'pending' : 'accepted')) return null;
  return { title: localeText(locale, kind === 'friend_request' ? 'push.friendRequestTitle' : 'push.friendAcceptedTitle'),
    body: localeText(locale, kind === 'friend_request' ? 'push.friendRequestBody' : 'push.friendAcceptedBody'),
    path: kind === 'friend_request' ? '/app/friends?tab=pending#received' : '/app/friends', tag: `social-${row.id}` };
}

export async function deliverWebPush(event: OutboxEvent): Promise<PushDeliveryResult> {
  const done = { delivered: true, retryAfterMs: 0 };
  if (!pushAvailable) return done;
  const [recipient] = await db.select({ status: users.status, locale: users.locale }).from(users).where(eq(users.id, event.audienceUserId)).limit(1);
  if (!recipient || recipient.status !== 'active') return done;
  const locale = resolveLocale(recipient.locale);
  const notice = await noticeFor(event, locale);
  if (!notice) return done;
  const subscriptions = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, event.audienceUserId));
  if (!subscriptions.length) return done;
  const receipts = await db.select({ endpoint: pushDeliveryReceipts.endpoint }).from(pushDeliveryReceipts)
    .where(eq(pushDeliveryReceipts.eventId, event.id));
  const deliveredEndpoints = new Set(receipts.map((receipt) => receipt.endpoint));
  const pending = subscriptions.filter((sub) => !deliveredEndpoints.has(sub.endpoint));
  if (!pending.length) return done;
  const body = JSON.stringify({ web_push: 8030, notification: {
    title: notice.title, body: notice.body,
    icon: new URL('/icons/icon-192.png', config.APP_URL).href,
    badge: new URL('/icons/notification-badge-96.png', config.APP_URL).href,
    navigate: new URL(notice.path, config.APP_URL).href, tag: notice.tag, lang: locale,
  } });
  const topic = crypto.createHash('sha256').update(notice.tag).digest('base64url').slice(0, 32);
  const results = await Promise.all(pending.map(async (sub): Promise<PushDeliveryResult> => {
    try {
      await webPush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
        vapidDetails: { subject: config.PUSH_VAPID_SUBJECT, publicKey: config.PUSH_VAPID_PUBLIC_KEY, privateKey: config.PUSH_VAPID_PRIVATE_KEY },
        contentEncoding: 'aes128gcm', TTL: event.type === 'chat_message_push' ? 3600 : 86400,
        urgency: 'normal', topic, timeout: 5000,
      });
      await db.insert(pushDeliveryReceipts).values({ eventId: event.id, endpoint: sub.endpoint }).onConflictDoNothing();
      return done;
    } catch (err) {
      const response = err as { statusCode?: number; headers?: unknown };
      const status = response.statusCode;
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, sub.endpoint), eq(pushSubscriptions.userId, event.audienceUserId),
          eq(pushSubscriptions.p256dh, sub.p256dh), eq(pushSubscriptions.auth, sub.auth)));
        return done;
      }
      log.warn('push delivery failed', { status: status ?? 'network', eventId: event.id });
      return { delivered: false, retryAfterMs: retryAfterDelayMs(response.headers) };
    }
  }));
  return { delivered: results.every((result) => result.delivered), retryAfterMs: Math.max(...results.map((result) => result.retryAfterMs)) };
}
