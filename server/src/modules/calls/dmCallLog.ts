import { db } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { announceStoredMessage } from '../messages/messages.js';
import { queueChatPush } from '../notifications/pushQueue.js';
import type { DmCallEndReason } from './dmCallMachine.js';

export interface DmCallLineInsert {
  conversationId: string;
  authorId: string;
  text: '';
  kind: 'dm_call';
  callDurationSeconds: number | null;
}

export interface EndedCall {
  conversationId: string;
  callerId: string;
  reason: DmCallEndReason;
  durationSeconds: number | null;
}

/** Decides whether an ended call becomes a chat line, and what the row stores.
 * The writer is injected so the decision can be tested without a database. */
export async function recordDmCallLine(effect: EndedCall, write: (values: DmCallLineInsert) => Promise<void>): Promise<void> {
  if (effect.reason === 'failed') return;
  await write({
    conversationId: effect.conversationId,
    authorId: effect.callerId,
    text: '',
    kind: 'dm_call',
    callDurationSeconds: effect.reason === 'ended' ? effect.durationSeconds : null,
  });
}

/** Inserts the line and announces it. A failure here must not undo the call ending. */
export async function persistDmCallLine(effect: EndedCall): Promise<void> {
  await recordDmCallLine(effect, async (values) => {
    const message = await db.transaction(async (tx) => {
      const [row] = await tx.insert(messages).values(values).returning();
      await queueChatPush(tx, { id: row!.id, conversationId: row!.conversationId, authorId: row!.authorId });
      return row!;
    });
    await announceStoredMessage(message.id);
  });
}
