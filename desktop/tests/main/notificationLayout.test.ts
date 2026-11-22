import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nativeNotificationFields, parseNotificationRequest, type NotificationRequest } from '../../src/main/notificationLayout.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const channelMessage = {
  id: 'chat-3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi', icon: PNG, group: '3f2b8c1e',
};

describe('parseNotificationRequest', () => {
  it('takes a request the page sends', () => {
    assert.deepEqual(parseNotificationRequest(channelMessage), channelMessage);
    assert.deepEqual(parseNotificationRequest({ id: 'social-1', title: 'Ana quer ser sua amiga', body: '' }), {
      id: 'social-1', title: 'Ana quer ser sua amiga', body: '', icon: null, group: null,
    });
  });

  it('refuses one without a usable id or title', () => {
    for (const value of [
      null, 'x', { ...channelMessage, id: '' }, { ...channelMessage, id: 'a b' }, { ...channelMessage, id: 'x'.repeat(65) },
      { ...channelMessage, title: '' }, { ...channelMessage, title: 3 }, { ...channelMessage, body: undefined },
    ]) assert.equal(parseNotificationRequest(value), null, JSON.stringify(value));
  });

  it('keeps only a PNG the page drew as the icon', () => {
    for (const icon of ['/icons/icon-192.png', 'https://example.com/a.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'file:///etc/passwd', `${PNG}"`]) {
      assert.equal(parseNotificationRequest({ ...channelMessage, icon })?.icon, null, icon);
    }
    assert.equal(parseNotificationRequest({ ...channelMessage, icon: `data:image/png;base64,${'A'.repeat(1_000_000)}` })?.icon, null);
  });

  it('drops a bad group but keeps the notification', () => {
    assert.equal(parseNotificationRequest({ ...channelMessage, group: '../x' })?.group, null);
  });

  it('caps long text', () => {
    const parsed = parseNotificationRequest({ ...channelMessage, title: 't'.repeat(1000), body: 'b'.repeat(5000) });
    assert.equal(parsed?.title.length, 256);
    assert.equal(parsed?.body.length, 1024);
  });
});

describe('nativeNotificationFields', () => {
  it('gives the toast its tag and group, with the page’s own title and body', () => {
    const request = parseNotificationRequest(channelMessage) as NotificationRequest;
    assert.deepEqual(nativeNotificationFields(request), { id: 'chat-3f2b8c1e', groupId: '3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi' });
    assert.deepEqual(nativeNotificationFields({ ...request, group: null }), { id: 'chat-3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi' });
  });
});
