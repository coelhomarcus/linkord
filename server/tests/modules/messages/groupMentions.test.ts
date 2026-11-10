import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedGroupMentions, groupMentionColumns, groupMentionRecipients } from '../../../src/modules/messages/groupMentions.js';

const OPEN = '11111111-1111-4111-8111-111111111111';
const CLOSED = '22222222-2222-4222-8222-222222222222';
const EVERYONE_ROLE = '33333333-3333-4333-8333-333333333333';
const OTHER_SERVER = '44444444-4444-4444-8444-444444444444';
const roles = [
  { id: EVERYONE_ROLE, isDefault: true, mentionable: true },
  { id: OPEN, isDefault: false, mentionable: true },
  { id: CLOSED, isDefault: false, mentionable: false },
];
const text = `@everyone @here <@&${OPEN}> <@&${CLOSED}> <@&${EVERYONE_ROLE}> <@&${OTHER_SERVER}>`;

describe('allowedGroupMentions', () => {
  test('without MENTION_EVERYONE only mentionable roles notify', () => {
    assert.deepEqual(allowedGroupMentions(text, roles, false), { everyone: false, here: false, roleIds: [OPEN] });
  });

  test('with it, @everyone, @here and every role of the server do', () => {
    assert.deepEqual(allowedGroupMentions(text, roles, true), { everyone: true, here: true, roleIds: [OPEN, CLOSED] });
  });

  test('never the @everyone role itself, nor a role of another server', () => {
    const { roleIds } = allowedGroupMentions(`<@&${EVERYONE_ROLE}> <@&${OTHER_SERVER}>`, roles, true);
    assert.deepEqual(roleIds, []);
  });

  test('a group inside code is text', () => {
    assert.deepEqual(allowedGroupMentions('`@everyone`', roles, true), { everyone: false, here: false, roleIds: [] });
  });

  test('is stored as one flag for @everyone and @here, and the roles or null', () => {
    assert.deepEqual(groupMentionColumns({ everyone: false, here: true, roleIds: [] }), { mentionEveryone: true, mentionRoleIds: null });
    assert.deepEqual(groupMentionColumns({ everyone: false, here: false, roleIds: [OPEN] }), { mentionEveryone: false, mentionRoleIds: [OPEN] });
  });
});

describe('groupMentionRecipients', () => {
  const viewers = ['a', 'b', 'c', 'd'];
  const held: Record<string, string[]> = { a: [OPEN], b: [CLOSED], c: [], d: [OPEN, CLOSED] };
  const roleIdsOf = (userId: string) => held[userId] ?? [];
  const online = (userId: string) => userId === 'b' || userId === 'c';

  test('@everyone reaches every viewer', () => {
    assert.deepEqual(groupMentionRecipients(viewers, { everyone: true, here: false, roleIds: [] }, roleIdsOf, online), viewers);
  });

  test('@here reaches the online ones, a role its holders, together their union', () => {
    assert.deepEqual(groupMentionRecipients(viewers, { everyone: false, here: true, roleIds: [] }, roleIdsOf, online), ['b', 'c']);
    assert.deepEqual(groupMentionRecipients(viewers, { everyone: false, here: false, roleIds: [OPEN] }, roleIdsOf, online), ['a', 'd']);
    assert.deepEqual(groupMentionRecipients(viewers, { everyone: false, here: true, roleIds: [OPEN] }, roleIdsOf, online), ['a', 'b', 'c', 'd']);
  });

  test('no groups reach nobody', () => {
    assert.deepEqual(groupMentionRecipients(viewers, { everyone: false, here: false, roleIds: [] }, roleIdsOf, online), []);
  });
});
