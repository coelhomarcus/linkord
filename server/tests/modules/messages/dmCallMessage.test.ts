import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rowToMessage, type MessageWithAuthor } from '../../../src/modules/messages/messages.js';

function row(over: Partial<MessageWithAuthor> = {}): MessageWithAuthor {
  return {
    id: 1,
    conversationId: 'dm-1',
    authorId: 'a',
    authorUsername: 'marcus',
    authorDisplayName: 'Marcus',
    authorAvatar: '',
    text: '',
    createdAt: new Date(0),
    editedAt: null,
    replyTo: null,
    kind: 'dm_call',
    serverInvitationId: null,
    callConversationId: null,
    callDurationSeconds: 90,
    mentionEveryone: false,
    mentionRoleIds: null,
    embeds: null,
    suppressedEmbeds: null,
    richEmbeds: null,
    stickerId: null,
    botName: null,
    botAvatar: null,
    ...over,
  };
}

describe('dm_call message mapping', () => {
  it('maps a dm_call row to a duration and no invite card', () => {
    const message = rowToMessage(row());
    assert.equal(message.kind, 'dm_call');
    assert.equal(message.text, '');
    assert.equal(message.callDurationSeconds, 90);
    assert.equal(message.callInvite, undefined);
    assert.equal(message.invitation, undefined);
  });

  it('keeps an unanswered call without a duration', () => {
    const message = rowToMessage(row({ callDurationSeconds: null }));
    assert.equal(message.kind, 'dm_call');
    assert.equal(message.callDurationSeconds, null);
  });
});
