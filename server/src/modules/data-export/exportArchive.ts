import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { aliasedTable, and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import yazl from 'yazl';
import { db } from '../../db/client.js';
import {
  attachments, conversationMembers, conversations, friendships, messages, profileConnections, profileGames, profileWallWidgets,
  serverMemberRoles, serverMembers, serverRoles, servers, userBlocks, users,
} from '../../db/schema.js';
import { filePathFor } from '../attachments/attachmentStorage.js';

// Builds the ZIP of a data export: what the account is (profile, settings, connections), who it knows
// (friends, blocks, servers) and what it sent (messages and their files). JSON for the records, the
// files as they are stored. Never other people's messages, and nothing secret (password hash, sessions,
// codes, tokens).

const MESSAGE_BATCH = 1000;
const LOCAL_UPLOAD_RE = /^\/uploads\/([0-9a-f]{32})$/;

/** A name that is safe as one path segment of the ZIP. */
const safeSegment = (name: string) => name.replace(/[\\/\0]/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

interface PersonRef { id: string; username: string; displayName: string }
const personOf = (u: { id: string; username: string; displayName: string }): PersonRef =>
  ({ id: u.id, username: u.username, displayName: u.displayName.trim() || u.username });

interface StoredFile { path: string; source: string; size: number }

/** The parts of the export, read before anything is written so a missing account fails early. */
async function readRecords(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const [connections, wallWidgets, games] = await Promise.all([
    db.select().from(profileConnections).where(eq(profileConnections.userId, userId)).orderBy(asc(profileConnections.position)),
    db.select().from(profileWallWidgets).where(eq(profileWallWidgets.userId, userId)).orderBy(asc(profileWallWidgets.position)),
    db.select().from(profileGames).where(eq(profileGames.userId, userId)).orderBy(asc(profileGames.list), asc(profileGames.position)),
  ]);

  const other = aliasedTable(users, 'other');
  const friendRows = await db.select({ f: friendships, other: { id: other.id, username: other.username, displayName: other.displayName } })
    .from(friendships)
    .innerJoin(other, or(
      and(eq(friendships.userLowId, userId), eq(other.id, friendships.userHighId)),
      and(eq(friendships.userHighId, userId), eq(other.id, friendships.userLowId)),
    ))
    .where(inArray(friendships.status, ['accepted', 'pending']))
    .orderBy(asc(friendships.createdAt));

  const blockRows = await db.select({ createdAt: userBlocks.createdAt, other: { id: users.id, username: users.username, displayName: users.displayName } })
    .from(userBlocks).innerJoin(users, eq(users.id, userBlocks.blockedId))
    .where(eq(userBlocks.blockerId, userId)).orderBy(asc(userBlocks.createdAt));

  const serverRows = await db.select({ id: servers.id, name: servers.name, ownerId: servers.ownerId, joinedAt: serverMembers.joinedAt })
    .from(serverMembers).innerJoin(servers, eq(servers.id, serverMembers.serverId))
    .where(eq(serverMembers.userId, userId)).orderBy(asc(serverMembers.joinedAt));
  const roleRows = serverRows.length === 0 ? [] : await db.select({ serverId: serverMemberRoles.serverId, name: serverRoles.name })
    .from(serverMemberRoles).innerJoin(serverRoles, eq(serverRoles.id, serverMemberRoles.roleId))
    .where(eq(serverMemberRoles.userId, userId)).orderBy(asc(serverRoles.position));

  return { user, connections, wallWidgets, games, friendRows, blockRows, serverRows, roleRows };
}

/** Where each conversation the account wrote in is, named for a person: a server channel or a DM partner. */
async function conversationLabels(userId: string, conversationIds: string[]): Promise<Map<string, Record<string, unknown>>> {
  const labels = new Map<string, Record<string, unknown>>();
  if (conversationIds.length === 0) return labels;
  const rows = await db.select({ id: conversations.id, type: conversations.type, title: conversations.title, serverId: servers.id, serverName: servers.name })
    .from(conversations).leftJoin(servers, eq(servers.id, conversations.serverId))
    .where(inArray(conversations.id, conversationIds));
  const partners = await db.select({ conversationId: conversationMembers.conversationId, id: users.id, username: users.username, displayName: users.displayName })
    .from(conversationMembers).innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(inArray(conversationMembers.conversationId, conversationIds));
  for (const c of rows) {
    if (c.type === 'direct') {
      const partner = partners.find((p) => p.conversationId === c.id && p.id !== userId);
      labels.set(c.id, { type: 'direct', conversationId: c.id, with: partner ? personOf(partner) : null });
    } else {
      labels.set(c.id, { type: 'channel', conversationId: c.id, channel: c.title, server: c.serverId ? { id: c.serverId, name: c.serverName } : null });
    }
  }
  return labels;
}

/** messages.json, written as it is read: an account may have sent far more than fits in memory. */
function messagesJson(userId: string, filesByMessage: Map<number, Record<string, unknown>[]>): Readable {
  async function* lines(): AsyncGenerator<string> {
    yield '[';
    let afterId = 0;
    let first = true;
    const labels = new Map<string, Record<string, unknown>>();
    for (;;) {
      const batch = await db.select({
        id: messages.id, conversationId: messages.conversationId, text: messages.text, kind: messages.kind,
        createdAt: messages.createdAt, editedAt: messages.editedAt, replyTo: messages.replyTo, stickerId: messages.stickerId,
      }).from(messages)
        .where(and(eq(messages.authorId, userId), isNull(messages.webhookId), gt(messages.id, afterId)))
        .orderBy(asc(messages.id)).limit(MESSAGE_BATCH);
      if (batch.length === 0) break;
      const unknown = [...new Set(batch.map((m) => m.conversationId))].filter((id) => !labels.has(id));
      for (const [id, label] of await conversationLabels(userId, unknown)) labels.set(id, label);
      for (const m of batch) {
        const replyTo = (m.replyTo as { msgId?: unknown } | null)?.msgId;
        const record = {
          id: m.id, sentAt: iso(m.createdAt), editedAt: iso(m.editedAt), kind: m.kind,
          where: labels.get(m.conversationId) ?? { conversationId: m.conversationId },
          text: m.text,
          replyToMessageId: typeof replyTo === 'number' ? replyTo : null,
          sticker: m.stickerId ? true : undefined,
          attachments: filesByMessage.get(m.id) ?? [],
        };
        yield `${first ? '\n' : ',\n'}${JSON.stringify(record)}`;
        first = false;
      }
      afterId = batch[batch.length - 1]!.id;
    }
    yield first ? ']\n' : '\n]\n';
  }
  return Readable.from(lines());
}

/** The size of a stored file, or null when it is not on this disk (deleted, or a dev database whose
 * files live on another instance). */
async function sizeOnDisk(id: string): Promise<number | null> {
  try {
    const stat = await fsp.stat(filePathFor(id));
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

const README = `This is a copy of the data of your Linkord account, made when you asked for it.

account.json      your profile, account details and settings
connections.json  the accounts and widgets on your profile, and the games you picked
friends.json      your friends and pending friend requests
blocks.json       the people you blocked
servers.json      the servers you belong to, with your roles in each
messages.json     every message you sent, where you sent it, and its attachments
attachments/      the files of those messages
profile/          your avatar and banner, when they are stored on this server

Dates are in UTC (ISO 8601). Messages other people sent are not included.
`;

/** Writes the ZIP of `userId`'s data to `destination`. Returns its size, or null if the account is gone. */
export async function writeExportArchive(userId: string, destination: string, now = new Date()): Promise<number | null> {
  const records = await readRecords(userId);
  if (!records) return null;
  const { user, connections, wallWidgets, games, friendRows, blockRows, serverRows, roleRows } = records;

  const files: StoredFile[] = [];

  // profile pictures stored here (an external URL is only a link, kept in account.json)
  const profileFiles: Record<string, string | null> = {};
  for (const [label, url] of [['avatar', user.avatar], ['banner', user.banner]] as const) {
    const match = LOCAL_UPLOAD_RE.exec(url);
    profileFiles[label] = null;
    if (!match) continue;
    const size = await sizeOnDisk(match[1]!);
    const [row] = await db.select({ mimeType: attachments.mimeType }).from(attachments).where(eq(attachments.id, match[1]!)).limit(1);
    if (size === null) continue;
    const ext = row?.mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const path = `profile/${label}.${ext}`;
    files.push({ path, source: match[1]!, size });
    profileFiles[label] = path;
  }

  // every file of every message the account sent, thumbnails aside (they are derived from the files)
  const attachmentRows = await db.select({
    id: attachments.id, messageId: attachments.messageId, fileName: attachments.fileName, mimeType: attachments.mimeType, size: attachments.size,
  }).from(attachments).innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(eq(messages.authorId, userId), isNull(messages.webhookId), eq(attachments.isThumbnail, false)))
    .orderBy(asc(attachments.messageId), asc(attachments.position));
  const filesByMessage = new Map<number, Record<string, unknown>[]>();
  for (const a of attachmentRows) {
    const size = await sizeOnDisk(a.id);
    const path = size === null ? null : `attachments/${a.messageId}-${a.id.slice(0, 8)}-${safeSegment(a.fileName)}`;
    if (path && size !== null) files.push({ path, source: a.id, size });
    const list = filesByMessage.get(a.messageId!) ?? [];
    list.push({ name: a.fileName, mimeType: a.mimeType, size: a.size, file: path, missing: path === null ? true : undefined });
    filesByMessage.set(a.messageId!, list);
  }

  const zip = new yazl.ZipFile();
  const options = { mtime: now };
  zip.addBuffer(Buffer.from(README), 'README.txt', options);
  zip.addBuffer(json({
    exportedAt: now.toISOString(),
    account: {
      id: user.id, username: user.username, displayName: user.displayName, email: user.email, role: user.role,
      createdAt: iso(user.createdAt), lastSeenAt: iso(user.lastSeenAt),
    },
    profile: {
      avatar: user.avatar, avatarFile: profileFiles.avatar, avatarColor: user.avatarColor,
      banner: user.banner, bannerFile: profileFiles.banner, bio: user.bio, links: user.profileLinks,
      customStatus: user.customStatusText || user.customStatusEmoji
        ? { emoji: user.customStatusEmoji, text: user.customStatusText, expiresAt: iso(user.customStatusExpiresAt) }
        : null,
    },
    settings: {
      language: user.locale, presenceStatus: user.presenceStatus, pushShowsMessageText: user.pushShowContent,
      twoStepLogin: user.twoFactorEmail, newSignInAlerts: user.loginAlertEmail,
    },
  }), 'account.json', options);
  zip.addBuffer(json({
    connections: connections.map((c) => ({ provider: c.provider, value: c.value, url: c.url, showOnProfile: c.showOnProfile })),
    wallWidgets: wallWidgets.map((w) => ({ type: w.type, connection: connections.find((c) => c.id === w.connectionId)?.provider ?? null })),
    games: games.map((g) => ({ list: g.list, name: g.name, igdbId: g.igdbId, releaseYear: g.releaseYear })),
  }), 'connections.json', options);
  zip.addBuffer(json(friendRows.map(({ f, other }) => ({
    person: personOf(other), status: f.status, requestedByYou: f.requestedBy === userId,
    requestedAt: iso(f.createdAt), acceptedAt: iso(f.acceptedAt),
  }))), 'friends.json', options);
  zip.addBuffer(json(blockRows.map((b) => ({ person: personOf(b.other), blockedAt: iso(b.createdAt) }))), 'blocks.json', options);
  zip.addBuffer(json(serverRows.map((s) => ({
    id: s.id, name: s.name, owner: s.ownerId === userId, joinedAt: iso(s.joinedAt),
    roles: roleRows.filter((r) => r.serverId === s.id).map((r) => r.name),
  }))), 'servers.json', options);
  zip.addReadStreamLazy('messages.json', options, (cb) => cb(null, messagesJson(userId, filesByMessage)));
  // media is already compressed: storing it as is saves the CPU for nothing lost
  for (const f of files) {
    zip.addReadStreamLazy(f.path, { ...options, compress: false, size: f.size }, (cb) => cb(null, fs.createReadStream(filePathFor(f.source))));
  }

  const out = fs.createWriteStream(destination, { mode: 0o600 });
  const failed = new Promise<never>((_, reject) => { zip.on('error', reject); out.on('error', reject); });
  zip.outputStream.pipe(out);
  zip.end();
  await Promise.race([finished(out), failed]);
  return (await fsp.stat(destination)).size;
}
