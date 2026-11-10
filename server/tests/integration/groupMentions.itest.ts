import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { messages, notifications, outboxEvents, serverMemberRoles, serverMembers, serverRoles, userBlocks, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import type { AppSocket, Participant } from '../../src/types.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

// notifyMentions runs after the send is answered; give it a moment to land
const settle = () => new Promise((r) => setTimeout(r, 150));

async function mentionCount(userId: string): Promise<number> {
  const rows = await db.select({ id: notifications.id }).from(notifications)
    .where(and(eq(notifications.recipientId, userId), eq(notifications.kind, 'mention')));
  return rows.length;
}

/** Sends as the joined account and returns the message it was answered with. */
async function send(socket: AppSocket, sent: { event: string; payload: any }[], conversationId: string, text: string) {
  await handlers.chat!(socket, { conversationId, text, requestId: 'r', clientMessageId: crypto.randomUUID() });
  await settle();
  const result = sent.filter((s) => s.event === 'chat-send-result').at(-1)!.payload;
  assert.ok(result.message, `the send was refused: ${JSON.stringify(result.error)}`);
  return result.message as { msgId: number; mentionEveryone?: true; mentionRoleIds?: string[] };
}

async function withJoined<T>(user: { id: string; username: string }, fn: (s: { socket: AppSocket; sent: { event: string; payload: any }[]; participant: Participant }) => Promise<T>): Promise<T> {
  const joined = joinNew(user);
  try {
    return await fn(joined);
  } finally {
    cleanupParticipant(joined.participant);
  }
}

async function makeRole(serverId: string, holders: string[], options: { mentionable?: boolean; permissions?: number } = {}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(serverRoles).values({ id, serverId, name: `role-${id.slice(0, 6)}`, position: 1, permissions: options.permissions ?? 0, mentionable: options.mentionable ?? false });
  for (const userId of holders) await db.insert(serverMemberRoles).values({ serverId, userId, roleId: id });
  invalidateAllServers();
  return id;
}

async function grantEveryone(serverId: string, bit: number): Promise<void> {
  await db.update(serverRoles).set({ permissions: sql`${serverRoles.permissions} | ${bit}` })
    .where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, true)));
  invalidateAllServers();
}

describe('group mentions (real Postgres)', () => {
  it('without MENTION_EVERYONE, @everyone and @here are sent but notify nobody and mark nothing', async () => {
    const owner = await makeUser('gm');
    const member = await makeUser('gm');
    const other = await makeUser('gm');
    const channelId = (await makeServerWithMembers(owner.id, [member.id, other.id])).textChannelId;
    const message = await withJoined(member, ({ socket, sent }) => send(socket, sent, channelId, '@everyone @here reunião agora'));
    assert.equal(message.mentionEveryone, undefined);
    const [row] = await db.select({ text: messages.text, flag: messages.mentionEveryone }).from(messages).where(eq(messages.id, message.msgId));
    assert.deepEqual(row, { text: '@everyone @here reunião agora', flag: false });
    assert.equal(await mentionCount(owner.id), 0);
    assert.equal(await mentionCount(other.id), 0);
  });

  it('@everyone from someone who may notifies every viewer once, never the author nor across a block', async () => {
    const owner = await makeUser('gm');
    const named = await makeUser('gm');
    const plain = await makeUser('gm');
    const blocker = await makeUser('gm');
    const outsider = await makeUser('gm');
    const channelId = (await makeServerWithMembers(owner.id, [named.id, plain.id, blocker.id])).textChannelId;
    await db.insert(userBlocks).values({ blockerId: blocker.id, blockedId: owner.id });
    const message = await withJoined(owner, ({ socket, sent }) => send(socket, sent, channelId, `@everyone e @${named.username} olhem`));
    assert.equal(message.mentionEveryone, true);
    assert.equal(await mentionCount(named.id), 1, 'a name and a group reaching the same member notify once');
    assert.equal(await mentionCount(plain.id), 1);
    assert.equal(await mentionCount(owner.id), 0);
    assert.equal(await mentionCount(blocker.id), 0);
    assert.equal(await mentionCount(outsider.id), 0);
  });

  it('a member granted MENTION_EVERYONE may; @here reaches only who is online', async () => {
    const owner = await makeUser('gm');
    const author = await makeUser('gm');
    const online = await makeUser('gm');
    const offline = await makeUser('gm');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [author.id, online.id, offline.id]);
    await grantEveryone(serverId, PERMISSIONS.MENTION_EVERYONE);
    const present = joinNew(online);
    try {
      const message = await withJoined(author, ({ socket, sent }) => send(socket, sent, textChannelId, '@here alguém aí?'));
      assert.equal(message.mentionEveryone, true);
    } finally {
      cleanupParticipant(present.participant);
    }
    assert.equal(await mentionCount(online.id), 1);
    assert.equal(await mentionCount(offline.id), 0);
    assert.equal(await mentionCount(owner.id), 0, 'the owner was not connected');
  });

  it('a role notifies its holders when it is mentionable or the author holds MENTION_EVERYONE', async () => {
    const owner = await makeUser('gm');
    const author = await makeUser('gm');
    const holder = await makeUser('gm');
    const bystander = await makeUser('gm');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [author.id, holder.id, bystander.id]);
    const closed = await makeRole(serverId, [holder.id]);
    const open = await makeRole(serverId, [holder.id, bystander.id], { mentionable: true });

    const refused = await withJoined(author, ({ socket, sent }) => send(socket, sent, textChannelId, `<@&${closed}> socorro`));
    assert.equal(refused.mentionRoleIds, undefined);
    assert.equal(await mentionCount(holder.id), 0);

    const accepted = await withJoined(author, ({ socket, sent }) => send(socket, sent, textChannelId, `<@&${closed}> <@&${open}> socorro`));
    assert.deepEqual(accepted.mentionRoleIds, [open]);
    assert.equal(await mentionCount(holder.id), 1);
    assert.equal(await mentionCount(bystander.id), 1);

    const byOwner = await withJoined(owner, ({ socket, sent }) => send(socket, sent, textChannelId, `<@&${closed}> por favor`));
    assert.deepEqual(byOwner.mentionRoleIds, [closed]);
    assert.equal(await mentionCount(holder.id), 2);
    assert.equal(await mentionCount(bystander.id), 1);
  });

  it('an edit is judged again: adding @everyone notifies, and the stored flags follow the text', async () => {
    const owner = await makeUser('gm');
    const member = await makeUser('gm');
    const channelId = (await makeServerWithMembers(owner.id, [member.id])).textChannelId;
    await withJoined(owner, async ({ socket, sent }) => {
      const message = await send(socket, sent, channelId, 'oi');
      await handlers['chat-edit']!(socket, { msgId: message.msgId, text: 'oi @everyone', requestId: 'e1' });
      await settle();
      assert.equal(await mentionCount(member.id), 1);
      await handlers['chat-edit']!(socket, { msgId: message.msgId, text: 'oi', requestId: 'e2' });
      const [row] = await db.select({ flag: messages.mentionEveryone }).from(messages).where(eq(messages.id, message.msgId));
      assert.equal(row?.flag, false);
    });
  });

  it("a webhook's @everyone counts when its creator may notify everyone", async () => {
    const owner = await makeUser('gm');
    const member = await makeUser('gm');
    const { textChannelId } = await makeServerWithMembers(owner.id, [member.id], 'Alertas');
    const cookie = `${config.SESSION_COOKIE}=${(await createSession(owner.id)).rawToken}`;
    const created = await app.inject({ method: 'POST', url: `/api/channels/${textChannelId}/webhooks`, payload: { name: 'Alertas' }, headers: { cookie } });
    const { webhook } = JSON.parse(created.body);
    await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: '@everyone CPU alta' } });
    await settle();
    assert.equal(await mentionCount(member.id), 1);
    assert.equal(await mentionCount(owner.id), 1, 'a bot is nobody, so its creator is notified too');
  });

  it('fans out to a large server in batches, one notification and one push event each', async () => {
    const owner = await makeUser('gm');
    const count = 1200;
    const ids = Array.from({ length: count }, () => crypto.randomUUID());
    await db.insert(users).values(ids.map((id) => ({ id, username: `gmb_${id.slice(0, 13)}`, passwordHash: 'x' })));
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, []);
    await db.insert(serverMembers).values(ids.map((userId) => ({ serverId, userId })));
    invalidateAllServers();
    const message = await withJoined(owner, ({ socket, sent }) => send(socket, sent, textChannelId, '@everyone manutenção às 22h'));
    await settle();
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(eq(notifications.messageId, message.msgId)) as [{ n: number }];
    assert.equal(n, count);
    const [{ events }] = await db.select({ events: sql<number>`count(*)::int` }).from(outboxEvents)
      .where(and(eq(outboxEvents.type, 'mention_created'), sql`${outboxEvents.payload}->>'messageId' = ${String(message.msgId)}`)) as [{ events: number }];
    assert.equal(events, count);
  });
});
