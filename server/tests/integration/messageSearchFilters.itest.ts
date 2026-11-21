import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { attachments, channelPermissionOverwrites, conversations, messages, serverRoles, webhooks } from '../../src/db/schema.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { handlers, SEARCH_PAGE_SIZE, type SearchRequest } from '../../src/modules/messages/messageSearch.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { befriend, cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

type Insert = typeof messages.$inferInsert;
type Result = { total: number; page: number; messages: { msgId: number }[] };

async function post(conversationId: string, authorId: string | null, text: string, extra: Partial<Insert> = {}): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text, ...extra }).returning({ id: messages.id });
  return row!.id;
}

async function attach(messageId: number, mimeType: string, fileName = 'f'): Promise<void> {
  await db.insert(attachments).values({ id: crypto.randomUUID().replace(/-/g, ''), messageId, fileName, mimeType, size: 1 });
}

/** Searches as `user` and returns the answer. */
async function searchAs(user: { id: string; username: string }, request: SearchRequest): Promise<Result> {
  const { socket, sent, participant } = joinNew(user);
  try {
    await handlers['search-messages']!(socket, { requestId: 'r', sort: 'newest', page: 1, ...request });
    const reply = sent.find((s) => s.event === 'search-messages-result');
    assert.ok(reply, 'no search result');
    assert.equal(reply.payload.requestId, 'r');
    return reply.payload;
  } finally {
    cleanupParticipant(participant);
  }
}
const idsOf = (result: Result) => result.messages.map((m) => m.msgId);

describe('header search with filters (real Postgres)', () => {
  it('filters by what a message carries, any of several kinds', async () => {
    const owner = await makeUser('sf');
    const { serverId, textChannelId: c } = await makeServerWithMembers(owner.id, []);
    const image = await post(c, owner.id, ''); await attach(image, 'image/png');
    const video = await post(c, owner.id, 'clipe'); await attach(video, 'video/mp4');
    const file = await post(c, owner.id, ''); await attach(file, 'application/pdf', 'doc.pdf');
    const link = await post(c, owner.id, 'olha https://example.com');
    const gif = await post(c, owner.id, 'https://static1.klipy.com/a/b.gif');
    const sticker = await post(c, owner.id, '', { stickerId: 'st1' });
    const plain = await post(c, owner.id, 'só texto');
    const scope = { serverId };
    assert.deepEqual(idsOf(await searchAs(owner, { scope, has: ['image'] })), [image]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, has: ['file'] })), [file]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, has: ['link'] })), [link]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, has: ['gif'] })), [gif]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, has: ['sticker'] })), [sticker]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, has: ['image', 'video'] })), [video, image]);
    const everything = await searchAs(owner, { scope });
    assert.ok(idsOf(everything).includes(plain));
    // an unknown kind is ignored, not an error
    assert.equal((await searchAs(owner, { scope, has: ['poll'] })).total, everything.total);
  });

  it('combines text, author, author type, mentions, pinned and dates', async () => {
    const owner = await makeUser('sf'); const member = await makeUser('sm');
    const { serverId, textChannelId: c } = await makeServerWithMembers(owner.id, [member.id]);
    const [hook] = await db.insert(webhooks).values({ id: crypto.randomUUID(), conversationId: c, tokenHash: 'x', name: 'CI' }).returning({ id: webhooks.id });
    const byOwner = await post(c, owner.id, 'deploy pronto', { createdAt: new Date('2026-01-10T12:00:00Z') });
    const byMember = await post(c, member.id, `deploy quebrou @${owner.username}`, { createdAt: new Date('2026-02-10T12:00:00Z') });
    const byBot = await post(c, null, 'deploy falhou', { webhookId: hook!.id, createdAt: new Date('2026-03-10T12:00:00Z') });
    const pinned = await post(c, member.id, 'regras', { pinnedAt: new Date() });
    // an address is not a mention
    await post(c, member.id, `mail ${owner.username}@example.com`);
    const scope = { serverId };
    assert.deepEqual(idsOf(await searchAs(owner, { scope, content: 'deploy', authorIds: [member.id] })), [byMember]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, content: 'deploy', authorType: ['bot'] })), [byBot]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, content: 'deploy', authorType: ['user'] })), [byMember, byOwner]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, mentionIds: [owner.id] })), [byMember]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, pinned: true })), [pinned]);
    assert.deepEqual(idsOf(await searchAs(owner, { scope, content: 'deploy', after: Date.parse('2026-02-01'), before: Date.parse('2026-03-01') })), [byMember]);
  });

  it('stays inside the server the account can see, and inside a DM', async () => {
    const owner = await makeUser('sf'); const member = await makeUser('sm');
    const server = await makeServerWithMembers(owner.id, [member.id]);
    const other = await makeServerWithMembers(owner.id, []);
    const [hidden] = await db.insert(conversations).values({ id: crypto.randomUUID(), type: 'text', title: 'secreto', serverId: server.serverId }).returning({ id: conversations.id });
    invalidateAllServers();
    const visible = await post(server.textChannelId, owner.id, 'segredo aberto');
    await post(other.textChannelId, owner.id, 'segredo de outro servidor');
    const inHidden = await post(hidden!.id, owner.id, 'segredo escondido');
    await hideFromEveryone(server.serverId, hidden!.id);
    const asMember = await searchAs(member, { scope: { serverId: server.serverId }, content: 'segredo' });
    assert.deepEqual(idsOf(asMember), [visible]);
    // naming a channel the member cannot see finds nothing there
    assert.equal((await searchAs(member, { scope: { serverId: server.serverId }, channelIds: [hidden!.id] })).total, 0);
    const asOwner = await searchAs(owner, { scope: { serverId: server.serverId }, content: 'segredo' });
    assert.deepEqual(idsOf(asOwner).sort(), [visible, inHidden].sort());
    // not a member of this one
    assert.equal((await searchAs(member, { scope: { serverId: other.serverId }, content: 'segredo' })).total, 0);

    const friend = await makeUser('sd');
    await befriend(owner.id, friend.id);
    const { conversation } = await getOrCreateDirect(owner.id, friend.id, owner.id);
    const dm = await post(conversation.id, friend.id, 'segredo na dm');
    assert.deepEqual(idsOf(await searchAs(owner, { scope: { conversationId: conversation.id }, content: 'segredo' })), [dm]);
    assert.equal((await searchAs(member, { scope: { conversationId: conversation.id }, content: 'segredo' })).total, 0);
  });

  it('sorts newest, oldest and by relevance, pages by 25 and counts the total', async () => {
    const owner = await makeUser('sf');
    const { serverId, textChannelId: c } = await makeServerWithMembers(owner.id, []);
    const ids: number[] = [];
    for (let i = 0; i < SEARCH_PAGE_SIZE + 3; i++) ids.push(await post(c, owner.id, i === 0 ? 'café café café' : `café ${i}`));
    const scope = { serverId };
    const first = await searchAs(owner, { scope, content: 'café' });
    assert.equal(first.total, SEARCH_PAGE_SIZE + 3);
    assert.equal(first.messages.length, SEARCH_PAGE_SIZE);
    assert.equal(idsOf(first)[0], ids.at(-1));
    const second = await searchAs(owner, { scope, content: 'café', page: 2 });
    assert.deepEqual(idsOf(second), ids.slice(0, 3).reverse());
    assert.equal(idsOf(await searchAs(owner, { scope, content: 'café', sort: 'oldest' }))[0], ids[0]);
    assert.equal(idsOf(await searchAs(owner, { scope, content: 'café', sort: 'relevant' }))[0], ids[0]);
  });

  it('leaves out the lines a pin leaves', async () => {
    const owner = await makeUser('sf');
    const { serverId, textChannelId: c } = await makeServerWithMembers(owner.id, []);
    const msg = await post(c, owner.id, 'texto');
    await post(c, owner.id, '', { kind: 'pin_notice', pinnedMessageId: msg });
    assert.deepEqual(idsOf(await searchAs(owner, { scope: { serverId } })), [msg]);
  });
});

/** Hides a channel from @everyone with an overwrite, the way the channel settings do. */
async function hideFromEveryone(serverId: string, channelId: string): Promise<void> {
  const [everyone] = await db.select({ id: serverRoles.id }).from(serverRoles).where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, true))).limit(1);
  await db.insert(channelPermissionOverwrites).values({ id: crypto.randomUUID(), serverId, channelId, roleId: everyone!.id, allow: 0, deny: PERMISSIONS.VIEW_CHANNEL });
  invalidateAllServers();
}
