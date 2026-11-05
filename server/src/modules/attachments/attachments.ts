import type { FastifyInstance } from 'fastify';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, type Attachment } from '../../db/schema.js';
import { handleAttachmentInit, handleAttachmentChunk, handleAttachmentComplete, handleAttachmentCancel } from './attachmentUploads.js';
import { serveUpload, handleAttachmentPreview } from './attachmentServing.js';

// Keep cleanup in a leaf module: message, conversation, presence, and moderation handlers all
// depend on it, so importing attachment routes here would create a cycle. Avatar uploads remain
// in the profile module even though they share this table.

/** One query for all messages' attachments (avoids N+1). Up to
 * MAX_ATTACHMENTS_PER_MESSAGE rows per message now (see
 * attachmentUploads.ts#handleAttachmentComplete's targetMsgId path) —
 * ordered by createdAt so multi-attachment order survives (attachments
 * upload sequentially, client-side, so createdAt timestamps never collide
 * in practice). */
export async function getByMessageIds(messageIds: number[]): Promise<Map<number, Attachment[]>> {
  const map = new Map<number, Attachment[]>();
  if (!messageIds.length) return map;
  const rows = await db.select().from(attachmentsTable)
    // isThumbnail rows share their parent's messageId on purpose (see
    // schema.ts) but must never surface as a second, duplicate attachment.
    .where(and(inArray(attachmentsTable.messageId, messageIds), eq(attachmentsTable.isThumbnail, false)))
    .orderBy(asc(attachmentsTable.position), asc(attachmentsTable.createdAt));
  for (const row of rows) {
    if (row.messageId === null) continue;
    const list = map.get(row.messageId);
    if (list) list.push(row); else map.set(row.messageId, [row]);
  }
  return map;
}

export function registerAttachmentRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/attachments/init', handleAttachmentInit);
  fastify.post('/api/attachments/:id/complete', handleAttachmentComplete);
  fastify.delete('/api/attachments/:id', handleAttachmentCancel);
  fastify.get('/uploads/:id', serveUpload);
  fastify.get('/api/attachments/:id/preview', handleAttachmentPreview);

  // raw Buffer body, not JSON — scoped plugin for just this route: swapping
  // addContentTypeParser on the root instance would break JSON parsing for
  // every other /api/* route. Chunk uploads are always binary.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/attachments/:id/chunk/:index', { bodyLimit: config.UPLOAD_CHUNK_BYTES }, handleAttachmentChunk);
  });
}
