import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nativeNotificationFields, parseNotificationRequest, type NotificationRequest } from '../../src/main/notificationLayout.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const channelMessage = {
  id: 'chat-3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi', icon: PNG, group: '3f2b8c1e',
  detail: { sender: 'Ana', place: '#geral · Clube', text: 'oi' },
};

describe('parseNotificationRequest', () => {
  it('takes a request the page sends', () => {
    assert.deepEqual(parseNotificationRequest(channelMessage), channelMessage);
    assert.deepEqual(parseNotificationRequest({ id: 'social-1', title: 'Ana quer ser sua amiga', body: '' }), {
      id: 'social-1', title: 'Ana quer ser sua amiga', body: '', icon: null, group: null, detail: null,
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

  it('drops a bad group or an incomplete detail but keeps the notification', () => {
    const parsed = parseNotificationRequest({ ...channelMessage, group: '../x', detail: { sender: 'Ana', place: '' } });
    assert.equal(parsed?.group, null);
    assert.equal(parsed?.detail, null);
  });

  it('caps long text', () => {
    const parsed = parseNotificationRequest({ ...channelMessage, title: 't'.repeat(1000), body: 'b'.repeat(5000) });
    assert.equal(parsed?.title.length, 256);
    assert.equal(parsed?.body.length, 1024);
  });
});

describe('nativeNotificationFields', () => {
  const request = parseNotificationRequest(channelMessage) as NotificationRequest;

  it('lays a channel message out as sender, channel and text on macOS', () => {
    assert.deepEqual(nativeNotificationFields(request, 'darwin'), {
      id: 'chat-3f2b8c1e', groupId: '3f2b8c1e', title: 'Ana', subtitle: '#geral · Clube', body: 'oi',
    });
  });

  it('keeps the page’s own title and body where there is no subtitle', () => {
    assert.deepEqual(nativeNotificationFields(request, 'win32'), { id: 'chat-3f2b8c1e', groupId: '3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi' });
    assert.deepEqual(nativeNotificationFields(request, 'linux'), { id: 'chat-3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi' });
  });

  it('shows the page’s title and body on macOS when there is no detail', () => {
    assert.deepEqual(nativeNotificationFields({ ...request, group: null, detail: null }, 'darwin'), {
      id: 'chat-3f2b8c1e', title: '#geral · Clube', body: 'Ana: oi',
    });
  });
});
