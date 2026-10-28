import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { messages } from '../../db/schema.js';
import { broadcastToConversationMembers } from '../conversations/conversationsRepository.js';
import { detectEmbed } from '../link-preview/embeds.js';
import { fetchLinkPreviewData, type LinkPreviewResult } from '../link-preview/linkPreview.js';
import { previewableLinks } from '../link-preview/messageLinks.js';

// A link card used to be fetched by every reader once its message was already
// on screen, and growing from a skeleton to the full card pushed the
// conversation around. Each card's preview is fetched once on the server,
// stored with the message and sent with it, so the card is laid out at its
// final size from the first frame — like the attachments' stored dimensions.

type Lookup = Parameters<typeof fetchLinkPreviewData>[2];

interface EmbeddableMessage { id: number; conversationId: string; text: string; suppressedEmbeds?: unknown }

/** The links of the message whose card its author removed, among the links
 * it still has (an edit can drop one). */
export function suppressedLinksFor(text: string, suppressed: unknown): string[] {
  if (!Array.isArray(suppressed)) return [];
  const links = new Set(previewableLinks(text));
  return suppressed.filter((url): url is string => typeof url === 'string' && links.has(url));
}

/** The links of a message that get a preview: the cards the client draws,
 * minus direct video and audio files (those play from the url itself) and
 * the ones whose card was removed. */
function previewTargets(text: string, suppressed: unknown = null): string[] {
  const removed = new Set(suppressedLinksFor(text, suppressed));
  return previewableLinks(text).filter((url) => {
    const kind = detectEmbed(url).kind;
    return kind !== 'video' && kind !== 'audio' && !removed.has(url);
  });
}

/** The stored previews that still belong to one of the message's links. */
export function storedEmbedsFor(text: string, embeds: unknown, suppressed: unknown = null): LinkPreviewResult[] {
  if (!Array.isArray(embeds)) return [];
  const targets = new Set(previewTargets(text, suppressed));
  return (embeds as LinkPreviewResult[]).filter((embed) => targets.has(embed.url));
}

export function needsEmbeds(message: { text: string; embeds?: unknown; suppressedEmbeds?: unknown }): boolean {
  const stored = new Set(storedEmbedsFor(message.text, message.embeds, message.suppressedEmbeds).map((embed) => embed.url));
  return previewTargets(message.text, message.suppressedEmbeds).some((url) => !stored.has(url));
}

/** Fetches the previews a message is missing, stores them, and tells the
 * conversation. Best-effort: rate limited or failed, a card just keeps no
 * stored preview and readers fetch it the old way. Stored only if the text is
 * still the one they were fetched for (an edit may have raced it). */
export async function unfurlMessage(message: EmbeddableMessage & { embeds?: unknown }, userId: string, lookup?: Lookup): Promise<void> {
  const embeds = storedEmbedsFor(message.text, message.embeds, message.suppressedEmbeds);
  const have = new Set(embeds.map((embed) => embed.url));
  const missing = previewTargets(message.text, message.suppressedEmbeds).filter((url) => !have.has(url));
  if (!missing.length) return;
  for (const url of missing) {
    try {
      embeds.push(await fetchLinkPreviewData(url, userId, lookup));
    } catch {
      break; // rate limited: what was fetched is still worth storing
    }
  }
  if (embeds.length === have.size) return;
  const order = previewTargets(message.text, message.suppressedEmbeds);
  embeds.sort((a, b) => order.indexOf(a.url) - order.indexOf(b.url));
  const stored = await db.update(messages).set({ embeds })
    .where(and(eq(messages.id, message.id), eq(messages.text, message.text)))
    .returning({ id: messages.id });
  if (!stored.length) return;
  await broadcastToConversationMembers(message.conversationId, { t: 'chat-embeds', conversationId: message.conversationId, msgId: message.id, embeds });
}

// messages already being filled in, so two readers opening the same history
// at once don't fetch and store the same previews twice
const backfilling = new Set<number>();

/** Messages from before previews were stored (or whose fetch failed) get
 * theirs the first time someone reads them; each lands through
 * 'chat-embeds'. One message at a time, behind the reader's own rate limit. */
export async function backfillEmbeds(rows: (EmbeddableMessage & { embeds?: unknown })[], userId: string, lookup?: Lookup): Promise<void> {
  for (const row of rows) {
    if (!needsEmbeds(row) || backfilling.has(row.id)) continue;
    backfilling.add(row.id);
    try {
      await unfurlMessage(row, userId, lookup);
    } finally {
      backfilling.delete(row.id);
    }
  }
}
