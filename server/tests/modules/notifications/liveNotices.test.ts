import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveNoticeKind, liveNoticeMessage } from '../../../src/modules/notifications/liveNotices.js';

const notice = {
  title: 'Fulano quer ser seu amigo', body: '@fulano', path: '/app/friends?tab=pending#received',
  tag: 'social-1', avatar: '/uploads/0123456789abcdef0123456789abcdef', renotify: true,
  person: { id: 'u1', name: 'Fulano', avatar: '/uploads/0123456789abcdef0123456789abcdef', avatarColor: 'teal' },
};

describe('live notices', () => {
  it('covers friend requests, accepted requests and server invitations', () => {
    assert.equal(liveNoticeKind('friend_request_created'), 'friend_request');
    assert.equal(liveNoticeKind('friend_request_accepted'), 'friend_accepted');
    assert.equal(liveNoticeKind('server_invitation_created'), 'server_invitation');
  });

  it('leaves chat messages and mentions to the page, which notifies them from the message', () => {
    assert.equal(liveNoticeKind('chat_message_push'), null);
    assert.equal(liveNoticeKind('mention_created'), null);
    assert.equal(liveNoticeKind('toString'), null);
    assert.equal(liveNoticeMessage({ type: 'mention_created', attempts: 0 }, notice), null);
  });

  it('carries what the push shows, on the first attempt only', () => {
    assert.deepEqual(liveNoticeMessage({ type: 'friend_request_created', attempts: 0 }, notice), {
      t: 'notice',
      notice: {
        kind: 'friend_request', title: notice.title, body: notice.body, path: notice.path, tag: notice.tag, person: notice.person,
      },
    });
    assert.equal(liveNoticeMessage({ type: 'friend_request_created', attempts: 1 }, notice), null);
  });

  it('carries the invitation’s server, and leaves out what the push alone uses', () => {
    const server = { id: 's1', name: 'Clube' };
    const message = liveNoticeMessage({ type: 'server_invitation_created', attempts: 0 }, { ...notice, server });
    assert.deepEqual(message?.notice.server, server);
    assert.equal(message && ('avatar' in message.notice || 'renotify' in message.notice), false);
  });
});
