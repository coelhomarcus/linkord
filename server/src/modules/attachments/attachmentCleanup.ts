import fs from 'node:fs/promises';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, conversations, messages, serverSounds, servers, users, webhooks } from '../../db/schema.js';
import { filePathFor } from './attachmentStorage.js';

// Deleting the on-disk file(s) when whatever owned them (a message, a whole
// conversation, a server, an account avatar) goes away. Kept in its own leaf
// file, same reasoning as attachmentStorage.ts: messages.ts, servers/,
// presence/participants.ts and moderation.ts all
// need this, and none of it depends on anything conversations/participants-
// related — putting it here (rather than in attachments.ts, which pulls in
// attachmentUploads.ts/attachmentServing.ts, which in turn depend on
// conversationsRepository.ts) means those 4 callers can import it statically
// instead of needing a dynamic `import()` to dodge a cycle.

// only matches our own upload format (see attachmentStorage.ts#newId) — an
// external URL just doesn't match, treated as "not ours," not an error.
const AVATAR_URL_RE = /^\/uploads\/([0-9a-f]{32})$/;

/** Deletes the on-disk file(s) only — the DB row(s) disappear via CASCADE
 * when the message is deleted right after (see modules/messages/messages.ts).
 * Postgres doesn't know about the file, so that part has to happen
 * separately. */
export async function deleteForMessage(messageId: number): Promise<void> {
  const rows = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, messageId));
  await Promise.all(rows.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
}

/** Removes one attachment from a message: its row, its thumbnail's row, and
 * both files. False when it is not (or no longer) one of that message's
 * attachments. */
export async function deleteAttachmentOfMessage(messageId: number, attachmentId: string): Promise<boolean> {
  const [row] = await db.select().from(attachmentsTable).where(and(
    eq(attachmentsTable.id, attachmentId),
    eq(attachmentsTable.messageId, messageId),
    eq(attachmentsTable.isThumbnail, false),
  )).limit(1);
  if (!row) return false;
  const ids = row.thumbId ? [row.id, row.thumbId] : [row.id];
  await db.delete(attachmentsTable).where(and(inArray(attachmentsTable.id, ids), eq(attachmentsTable.messageId, messageId)));
  await Promise.all(ids.map((id) => fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
  return true;
}

const unlinkAll = (ids: { id: string }[]) =>
  Promise.all(ids.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));

/** Same idea in bulk — deleting a conversation CASCADEs messages/attachments
 * in Postgres without going through deleteForMessage, so this exists purely
 * to avoid orphaned files. Called before the delete. */
export async function deleteForConversation(conversationId: string): Promise<void> {
  await unlinkAll(await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .innerJoin(messages, eq(attachmentsTable.messageId, messages.id))
    .where(eq(messages.conversationId, conversationId)));
}

/** Every file a server owns — each channel's attachments and the
 * soundboard — before the server row (and everything cascading from it)
 * is deleted. */
export async function deleteForServer(serverId: string): Promise<void> {
  await unlinkAll(await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .innerJoin(messages, eq(attachmentsTable.messageId, messages.id))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(conversations.serverId, serverId)));
  await unlinkAll(await db.select({ id: serverSounds.id }).from(serverSounds).where(eq(serverSounds.serverId, serverId)));
}

/** Local upload URLs are safe to claim only when the uploader owns a profile-image row for them.
 * This prevents a forged avatar reference from causing cleanup to delete another user's file.
 * External URLs and empty values have no local file to protect. */
export async function isOwnedProfileImage(url: string, uploaderId: string): Promise<boolean> {
  const match = AVATAR_URL_RE.exec(url);
  if (!match) return true;
  const id = match[1]!;
  const [row] = await db.select({ id: attachmentsTable.id }).from(attachmentsTable)
    .where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId), eq(attachmentsTable.uploaderId, uploaderId)))
    .limit(1);
  return !!row;
}

/** Whether some OTHER account's avatar/banner, server's icon or webhook's
 * avatar is still literally set to this exact URL right now —
 * deleteAvatarFile's caller always updates ITS OWN row to the new value
 * before calling this for the old one, so if the string still turns up
 * anywhere at this point, something else is still actively using it. */
async function isProfileImageStillReferenced(url: string): Promise<boolean> {
  const [byUser] = await db.select({ id: users.id }).from(users)
    .where(or(eq(users.avatar, url), eq(users.avatarPoster, url), eq(users.banner, url), eq(users.bannerPoster, url)))
    .limit(1);
  if (byUser) return true;
  const [byServer] = await db.select({ id: servers.id }).from(servers).where(eq(servers.icon, url)).limit(1);
  if (byServer) return true;
  const [byWebhook] = await db.select({ id: webhooks.id }).from(webhooks).where(eq(webhooks.avatar, url)).limit(1);
  return !!byWebhook;
}

/** Deletes the OLD avatar file+row when an account or server switches to a
 * new one — otherwise old avatars pile up orphaned forever. No-ops for an
 * external URL or empty value. `isNull(messageId)` is a guard so a
 * manipulated value could never delete a real chat attachment; the
 * still-referenced check right before is what stops it from deleting a
 * DIFFERENT account's (or server's) current avatar/banner — see
 * isOwnedProfileImage's own comment for how such a reference could exist
 * at all. */
export async function deleteAvatarFile(avatarValue: unknown): Promise<void> {
  const match = AVATAR_URL_RE.exec(String(avatarValue == null ? '' : avatarValue));
  if (!match) return;
  const id = match[1]!;
  const url = `/uploads/${id}`;
  if (await isProfileImageStillReferenced(url)) return;
  const deleted = await db.delete(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).returning({ id: attachmentsTable.id });
  if (!deleted.length) return; // wasn't actually an avatar row — leave the file alone
  await fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}
