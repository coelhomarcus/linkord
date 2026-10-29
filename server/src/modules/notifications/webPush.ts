import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import webPush from 'web-push';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, friendships, groupInvitations, messages, notifications, pushDeliveryReceipts, pushSubscriptions, users, type OutboxEvent } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';

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

async function noticeFor(event: OutboxEvent): Promise<PushNotice | null> {
  const payload = event.payload as Record<string, unknown>;
  if (event.type === 'chat_message_push') {
    if (!Number.isSafeInteger(payload.messageId)) return null;
    const [row] = await db.select({ message: messages, member: conversationMembers, conversation: conversations, author: users })
      .from(messages)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, event.audienceUserId)))
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .leftJoin(users, eq(users.id, messages.authorId))
      .where(eq(messages.id, payload.messageId as number)).limit(1);
    if (!row || row.conversation.status !== 'active' || (row.member.lastReadMessageId ?? 0) >= row.message.id) return null;
    if (row.conversation.type === 'direct' && row.message.authorId
      && !(await canSendDirectMessage(row.message.authorId, event.audienceUserId))) return null;
    const [mention] = await db.select({ id: notifications.id }).from(notifications).where(and(
      eq(notifications.recipientId, event.audienceUserId), eq(notifications.kind, 'mention'),
      eq(notifications.messageId, row.message.id), isNull(notifications.readAt),
    )).limit(1);
    if (mention) return null;
    const name = row.author ? row.author.displayName || row.author.username : row.conversation.type === 'bot' ? row.conversation.title || 'Bot' : 'Alguém';
    const text = row.message.text.replace(/\s+/g, ' ').trim().slice(0, 120);
    const title = row.conversation.type === 'direct' ? name : row.conversation.title || 'Conversa';
    return { title, body: text ? `${name}: ${text}` : `${name} enviou uma mensagem`,
      path: `/app/conversations/${encodeURIComponent(row.conversation.id)}`, tag: `chat-${row.conversation.id}` };
  }

  const kind = event.type === 'friend_request_created' ? 'friend_request'
    : event.type === 'friend_request_accepted' ? 'friend_accepted'
      : event.type === 'group_invitation_created' ? 'group_invitation'
        : event.type === 'mention_created' ? 'mention' : null;
  if (!kind) return null;
  const reference = kind === 'mention' ? payload.messageId : kind === 'group_invitation' ? payload.invitationId : payload.friendshipId;
  if (typeof reference !== 'string' && typeof reference !== 'number') return null;
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(and(
    eq(notifications.recipientId, event.audienceUserId), eq(notifications.kind, kind), isNull(notifications.readAt),
    kind === 'mention' ? eq(notifications.messageId, Number(reference))
      : kind === 'group_invitation' ? eq(notifications.groupInvitationId, String(reference))
        : eq(notifications.friendshipId, String(reference)),
  )).limit(1);
  if (!row) return null;
  if (kind === 'mention') {
    const [message] = await db.select({ conversationId: messages.conversationId, conversationType: conversations.type, authorId: messages.authorId })
      .from(messages)
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, event.audienceUserId)))
      .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.status, 'active')))
      .where(eq(messages.id, Number(reference))).limit(1);
    if (!message) return null;
    if (message.conversationType === 'direct' && message.authorId
      && !(await canSendDirectMessage(message.authorId, event.audienceUserId))) return null;
    return { title: 'Você foi mencionado', body: 'Abra a conversa para ver a mensagem.',
      path: `/app/conversations/${encodeURIComponent(message.conversationId)}`, tag: `mention-${row.id}` };
  }
  if (kind === 'group_invitation') {
    const [invitation] = await db.select({ status: groupInvitations.status }).from(groupInvitations).where(eq(groupInvitations.id, String(reference))).limit(1);
    if (!invitation || invitation.status !== 'pending') return null;
    return { title: 'Convite para grupo', body: 'Você recebeu um convite no Linkord.', path: '/app/friends?tab=invitations', tag: `social-${row.id}` };
  }
  const [friendship] = await db.select({ status: friendships.status }).from(friendships).where(eq(friendships.id, String(reference))).limit(1);
  if (!friendship || friendship.status !== (kind === 'friend_request' ? 'pending' : 'accepted')) return null;
  return { title: kind === 'friend_request' ? 'Solicitação de amizade' : 'Solicitação aceita',
    body: kind === 'friend_request' ? 'Você recebeu uma solicitação no Linkord.' : 'Uma pessoa aceitou sua solicitação.',
    path: kind === 'friend_request' ? '/app/friends?tab=pending#received' : '/app/friends', tag: `social-${row.id}` };
}

export async function deliverWebPush(event: OutboxEvent): Promise<PushDeliveryResult> {
  const done = { delivered: true, retryAfterMs: 0 };
  if (!pushAvailable) return done;
  const [recipient] = await db.select({ status: users.status }).from(users).where(eq(users.id, event.audienceUserId)).limit(1);
  if (!recipient || recipient.status !== 'active') return done;
  const notice = await noticeFor(event);
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
    badge: new URL('/icons/icon-192.png', config.APP_URL).href,
    navigate: new URL(notice.path, config.APP_URL).href, tag: notice.tag, lang: 'pt-BR',
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
