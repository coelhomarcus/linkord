import crypto from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversationMembers, outboxEvents } from '../../db/schema.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The message and these per-recipient jobs commit together. A send retry
 * does not queue again because only the newly inserted message calls this. */
export async function queueChatPush(tx: Tx, message: { id: number; conversationId: string; authorId: string | null }): Promise<void> {
  if (!config.PUSH_VAPID_PUBLIC_KEY) return;
  const recipients = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, message.conversationId),
      message.authorId ? ne(conversationMembers.userId, message.authorId) : undefined));
  if (!recipients.length) return;
  await tx.insert(outboxEvents).values(recipients.map(({ userId }) => ({
    id: crypto.randomUUID(), type: 'chat_message_push', audienceUserId: userId,
    payload: { messageId: message.id },
  })));
}
