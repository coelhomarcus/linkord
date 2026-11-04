import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversations, outboxEvents } from '../../db/schema.js';
import { conversationAudienceIds } from '../conversations/conversationsRepository.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The message and these per-recipient jobs commit together. A send retry
 * does not queue again because only the newly inserted message calls this. */
export async function queueChatPush(tx: Tx, message: { id: number; conversationId: string; authorId: string | null }): Promise<void> {
  if (!config.PUSH_VAPID_PUBLIC_KEY) return;
  const [conversation] = await tx.select({ id: conversations.id, serverId: conversations.serverId }).from(conversations)
    .where(eq(conversations.id, message.conversationId)).limit(1);
  if (!conversation) return;
  const recipients = (await conversationAudienceIds(conversation)).filter((userId) => userId !== message.authorId);
  if (!recipients.length) return;
  await tx.insert(outboxEvents).values(recipients.map((userId) => ({
    id: crypto.randomUUID(), type: 'chat_message_push', audienceUserId: userId,
    payload: { messageId: message.id },
  })));
}
