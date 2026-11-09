import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rowToMessage, type MessageWithAuthor } from '../../../src/modules/messages/messages.js';
import { normalizeReplyRef } from '../../../src/modules/messages/replyRef.js';
import { sendPayloadHash } from '../../../src/modules/messages/sendOperations.js';

const STICKER_ID = 'b'.repeat(32);

function row(over: Partial<MessageWithAuthor> = {}): MessageWithAuthor {
  return {
    id: 1, conversationId: 'c-1', authorId: 'a', authorUsername: 'ana', authorDisplayName: 'Ana', authorAvatar: '',
    text: '', createdAt: new Date(0), editedAt: null, replyTo: null, kind: 'text',
    serverInvitationId: null, callConversationId: null, callDurationSeconds: null,
    embeds: null, suppressedEmbeds: null, richEmbeds: null, stickerId: STICKER_ID, botName: null, botAvatar: null,
    ...over,
  };
}

describe('sticker message mapping', () => {
  it('carries the sticker card', () => {
    const card = { id: STICKER_ID, name: 'abraço', description: 'um gato', animated: true };
    assert.deepEqual(rowToMessage(row(), undefined, undefined, undefined, undefined, card).sticker, card);
  });

  it('marks a deleted sticker as null, so it is not drawn as a blank message', () => {
    assert.equal(rowToMessage(row()).sticker, null);
  });

  it('leaves a plain message without the field', () => {
    assert.equal('sticker' in rowToMessage(row({ stickerId: null, text: 'oi' })), false);
  });
});

describe('sticker reply reference', () => {
  it('keeps the name of the sticker replied to', () => {
    assert.equal(normalizeReplyRef({ msgId: 3, authorId: 'a', text: '', sticker: 'abraço' })?.sticker, 'abraço');
    assert.equal(normalizeReplyRef({ msgId: 3, authorId: 'a', text: 'oi' })?.sticker, undefined);
  });
});

describe('sticker send key', () => {
  it('tells a sticker send apart from an empty one, and keeps text sends hashed as before', () => {
    const base = { conversationId: 'c-1', text: '', replyTo: null };
    assert.notEqual(sendPayloadHash({ ...base, stickerId: STICKER_ID }), sendPayloadHash(base));
    assert.equal(sendPayloadHash({ ...base, text: 'oi', stickerId: null }), sendPayloadHash({ ...base, text: 'oi' }));
  });
});
