import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { dmCallsActive } from '../../db/schema.js';
import type { DmCall } from './dmCallMachine.js';
import type { DmCallStore } from './dmCalls.js';

export const dmCallStore: DmCallStore = {
  async save(call) {
    const values = {
      conversationId: call.conversationId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      callerParticipantId: call.callerParticipantId,
      calleeParticipantId: call.calleeParticipantId,
      video: call.video,
      phase: call.phase,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt,
    };
    await db.insert(dmCallsActive)
      .values({ id: call.id, ...values })
      .onConflictDoUpdate({ target: dmCallsActive.id, set: values });
  },
  async remove(callId) {
    await db.delete(dmCallsActive).where(eq(dmCallsActive.id, callId));
  },
};

export async function loadActiveDmCalls(): Promise<DmCall[]> {
  const rows = await db.select().from(dmCallsActive);
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    callerId: row.callerId,
    calleeId: row.calleeId,
    callerParticipantId: row.callerParticipantId,
    calleeParticipantId: row.calleeParticipantId,
    video: row.video,
    phase: row.phase,
    startedAt: row.startedAt,
    answeredAt: row.answeredAt,
  }));
}
