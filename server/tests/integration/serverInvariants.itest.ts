import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { config } from '../../src/config/env.js';
import { removeMember, transferOwnership } from '../../src/modules/servers/serverMembership.js';
import { acceptInvitation, createInvitations, declineInvitation, revokeInvitationForDeletedCard } from '../../src/modules/servers/serverInvitationsRepository.js';
import { deleteUserAccount } from '../../src/modules/admin/adminUsers.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { befriend, db, makeServerWithMembers, makeUser, memberCount, ownerOf, pool } from './helpers.js';
import { adminAuditLogs, conversationMembers, serverInvitations, serverMembers, servers } from '../../src/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';

after(() => pool.end());

const isMember = async (serverId: string, userId: string) =>
  (await db.select().from(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId)))).length > 0;

describe('server invariants under concurrency (real Postgres)', () => {
  it('transfer × kick × leave: a server with members always has one of them as owner (15 rounds)', async () => {
    for (let round = 0; round < 15; round++) {
      const a = await makeUser('o'); const b = await makeUser('m'); const c = await makeUser('m');
      const { serverId } = await makeServerWithMembers(a.id, [b.id, c.id]);
      const ops = [
        () => transferOwnership(serverId, a.id, b.id),
        () => removeMember(serverId, a.id, b.id, 'kick'),
        () => removeMember(serverId, a.id, a.id, 'leave'),
        () => removeMember(serverId, b.id, b.id, 'leave'),
      ];
      await Promise.allSettled((round % 2 ? ops : [...ops].reverse()).map((op) => op()));
      const members = await memberCount(serverId);
      const owner = await ownerOf(serverId);
      if (members > 0) assert.ok(owner && (await isMember(serverId, owner)), `round ${round}: ${members} members, owner ${owner} not among them`);
    }
  });

  it('DM is idempotent: 12 simultaneous creations of the same pair yield ONE conversation', async () => {
    const a = await makeUser('dm'); const b = await makeUser('dm');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => getOrCreateDirect(i % 2 ? a.id : b.id, i % 2 ? b.id : a.id, a.id)));
    assert.equal(new Set(results.map((r) => r.conversation.id)).size, 1);
    assert.equal(results.filter((r) => r.created).length, 1);
    const [dm] = await db.select({ n: sql<number>`count(*)::int` }).from(conversationMembers).where(eq(conversationMembers.conversationId, results[0]!.conversation.id));
    assert.equal(dm!.n, 2);
  });

  it('a double accept (two tabs) creates ONE member', async () => {
    const owner = await makeUser('ow'); const guest = await makeUser('gu');
    await befriend(owner.id, guest.id);
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const invited = await createInvitations(owner.id, serverId, [guest.id]);
    assert.ok('results' in invited);
    const invitationId = invited.results[0]!.invitationId!;
    const outcomes = await Promise.all([1, 2, 3].map(() => acceptInvitation(guest.id, invitationId)));
    assert.ok(outcomes.every((o) => o.code === 'ok'));
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, guest.id)));
    assert.equal(row!.n, 1);
  });

  it('the last slot goes to only ONE of those accepting at the same time', async () => {
    const original = config.MAX_SERVER_MEMBERS;
    config.MAX_SERVER_MEMBERS = 3;
    try {
      const owner = await makeUser('sf'); const existing = await makeUser('sf');
      const { serverId } = await makeServerWithMembers(owner.id, [existing.id]);
      const guests = await Promise.all([makeUser('sf'), makeUser('sf'), makeUser('sf')]);
      for (const guest of guests) await befriend(owner.id, guest.id);
      const invited = await createInvitations(owner.id, serverId, guests.map((x) => x.id));
      assert.ok('results' in invited);
      const outcomes = await Promise.all(guests.map((guest, i) => acceptInvitation(guest.id, invited.results[i]!.invitationId!)));
      assert.equal(outcomes.filter((o) => o.code === 'ok').length, 1, JSON.stringify(outcomes.map((o) => o.code)));
      assert.equal(outcomes.filter((o) => o.code === 'server_full').length, 2);
      assert.equal(await memberCount(serverId), 3);
    } finally {
      config.MAX_SERVER_MEMBERS = original;
    }
  });

  it('deleting the owner passes the server to the oldest member, in the same lock, and audits it', async () => {
    const admin = await makeUser('adm', 'admin');
    const owner = await makeUser('dead'); const oldest = await makeUser('old'); const newer = await makeUser('new');
    const { serverId } = await makeServerWithMembers(owner.id, [oldest.id, newer.id]);
    const solo = await makeServerWithMembers(owner.id, []);
    const result = await deleteUserAccount({ actor: { id: admin.id, username: admin.username }, reason: 'itest', requestId: '' }, owner.id, owner.username);
    assert.equal(result.code, 'ok');
    assert.equal(await ownerOf(serverId), oldest.id);
    assert.equal((await db.select().from(servers).where(eq(servers.id, solo.serverId))).length, 0, 'a server with only the owner disappears');
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.action, 'server.owner_succession'), eq(adminAuditLogs.targetId, serverId)));
    assert.equal(trail.length, 1);
  });

  it('deleting the owner × transferring × leaving (10 rounds): the server never ends up owned by a non-member', async () => {
    const admin = await makeUser('adm', 'admin');
    for (let round = 0; round < 10; round++) {
      const owner = await makeUser('dx'); const b = await makeUser('m'); const c = await makeUser('m');
      const { serverId } = await makeServerWithMembers(owner.id, [b.id, c.id]);
      await Promise.allSettled([
        deleteUserAccount({ actor: { id: admin.id, username: admin.username }, reason: 'itest', requestId: '' }, owner.id, owner.username),
        transferOwnership(serverId, owner.id, c.id),
        removeMember(serverId, c.id, c.id, 'leave'),
      ]);
      const members = await memberCount(serverId);
      const ownerId = await ownerOf(serverId);
      if (members > 0) assert.ok(ownerId && (await isMember(serverId, ownerId)), `round ${round}: owner ${ownerId} is not a member`);
    }
  });
});

describe('a named invitation has no expiry and no cooldown (real Postgres)', () => {
  it('a pending invitation never expires and declining it does not block resending', async () => {
    const owner = await makeUser('iv'); const guest = await makeUser('ig');
    await befriend(owner.id, guest.id);
    const { serverId: g } = await makeServerWithMembers(owner.id, []);
    const first = await createInvitations(owner.id, g, [guest.id]);
    assert.ok('results' in first);
    const id = first.results[0]!.invitationId!;
    const [row] = await db.select().from(serverInvitations).where(eq(serverInvitations.id, id));
    assert.equal(row!.expiresAt, null);

    const declined = await declineInvitation(guest.id, id);
    assert.equal(declined.code, 'ok');
    const again = await createInvitations(owner.id, g, [guest.id]);
    assert.ok('results' in again);
    assert.equal(again.results[0]!.outcome, 'sent');
  });

  it('deleting the card revokes the pending invitation; whoever already joined stays a member', async () => {
    const owner = await makeUser('dc'); const pending = await makeUser('dp'); const joined = await makeUser('dj');
    await befriend(owner.id, pending.id); await befriend(owner.id, joined.id);
    const { serverId: g } = await makeServerWithMembers(owner.id, []);
    const sent = await createInvitations(owner.id, g, [pending.id, joined.id]);
    assert.ok('results' in sent);
    const [invPending, invJoined] = sent.results.map((r) => r.invitationId!);
    assert.equal((await acceptInvitation(joined.id, invJoined!)).code, 'ok');

    await revokeInvitationForDeletedCard(invPending!);
    await revokeInvitationForDeletedCard(invJoined!);

    const [p] = await db.select().from(serverInvitations).where(eq(serverInvitations.id, invPending!));
    const [j] = await db.select().from(serverInvitations).where(eq(serverInvitations.id, invJoined!));
    assert.equal(p!.status, 'revoked');
    assert.equal(j!.status, 'accepted');
    assert.equal((await acceptInvitation(pending.id, invPending!)).code, 'invalid_state');
    assert.equal(await memberCount(g), 2);
  });
});
