import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyIncomingChatMessage, notifyLiveNotice, setNoticeNavigationHandler, setNotificationClickHandler, setNotificationsModuleEnabled, setPushSubscriptionActive } from '@/shared/notifications';
import type { LiveNotice } from '@/shared/types/protocol';
import type { IncomingChatEvent } from '@/shared/notifications';
import { setDoNotDisturb } from '@/shared/doNotDisturb';
import { notificationIcon } from '@/shared/notificationIcon';

vi.mock('@/shared/notificationIcon', () => ({
  FALLBACK_NOTIFICATION_ICON: '/icons/icon-192.png',
  notificationIcon: vi.fn(async () => 'data:image/png;base64,drawn'),
}));

interface FakeNotificationInstance {
  title: string;
  options: NotificationOptions | undefined;
  onclick: (() => void) | null;
  close: () => void;
}

let created: FakeNotificationInstance[] = [];

class FakeNotification {
  static permission: NotificationPermission = 'granted';
  title: string;
  options: NotificationOptions | undefined;
  onclick: (() => void) | null = null;
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    created.push(this);
  }
  close(): void {}
}

function baseEvent(overrides: Partial<IncomingChatEvent> = {}): IncomingChatEvent {
  return {
    conversationId: 'ch-1',
    conversationName: 'geral',
    direct: false,
    senderId: 'user-1',
    senderName: 'Fulano',
    text: 'oi',
    mentioned: false,
    ...overrides,
  };
}

beforeEach(() => {
  created = [];
  vi.mocked(notificationIcon).mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  vi.useFakeTimers();
  setNotificationsModuleEnabled(true);
});

afterEach(() => {
  setNotificationsModuleEnabled(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('notifyIncomingChatMessage', () => {
  it('does not create a notification when the module is disabled', async () => {
    setNotificationsModuleEnabled(false);
    notifyIncomingChatMessage(baseEvent());
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(0);
  });

  it('does not create a notification in do not disturb', async () => {
    setDoNotDisturb(true);
    notifyIncomingChatMessage(baseEvent());
    await vi.runAllTimersAsync();
    setDoNotDisturb(false);
    expect(created).toHaveLength(0);
  });

  it('does not create a notification without permission granted', async () => {
    FakeNotification.permission = 'default';
    notifyIncomingChatMessage(baseEvent());
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(0);
    FakeNotification.permission = 'granted';
  });

  it('a single message generates "Sender: text"', async () => {
    notifyIncomingChatMessage(baseEvent({ senderName: 'Fulano', text: 'oi pessoal' }));
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('Fulano: oi pessoal');
    expect(created[0]!.options?.tag).toBe('chat-ch-1');
  });

  it('a quick burst from the same sender in the same channel collapses into ONE notification', async () => {
    for (let i = 0; i < 6; i++) {
      notifyIncomingChatMessage(baseEvent({ text: `mensagem ${i}` }));
      vi.advanceTimersByTime(200);
    }
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('Fulano enviou 6 mensagens');
  });

  it('a burst with different senders in the same channel collapses by citing the number of people', async () => {
    notifyIncomingChatMessage(baseEvent({ senderId: 'user-1', senderName: 'Fulano' }));
    vi.advanceTimersByTime(200);
    notifyIncomingChatMessage(baseEvent({ senderId: 'user-2', senderName: 'Ciclano' }));
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('2 pessoas enviaram mensagens');
  });

  it('different conversations do not mix (buffer per conversation)', async () => {
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-1' }));
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-2' }));
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(2);
    expect(created.map((n) => n.options?.tag).sort()).toEqual(['chat-ch-1', 'chat-ch-2']);
  });

  it('a continuous burst (no pause) still fires periodically (MAX_WAIT)', async () => {
    for (let i = 0; i < 40; i++) {
      notifyIncomingChatMessage(baseEvent({ text: `m${i}` }));
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(created.length).toBeGreaterThan(0);
  });

  it('a message with a mention uses a distinct title', async () => {
    notifyIncomingChatMessage(baseEvent({ mentioned: true }));
    await vi.runAllTimersAsync();
    expect(created[0]!.title).toBe('Você foi mencionado em geral');
  });
});

describe('notifyIncomingChatMessage — wording and picture', () => {
  const server = { id: 's1', name: 'Clube', icon: '/uploads/server' };

  it('a DM is titled by the sender and its body is just the text', async () => {
    notifyIncomingChatMessage(baseEvent({ conversationName: 'Fulano', direct: true, text: 'oi' }));
    await vi.runAllTimersAsync();
    expect(created[0]!.title).toBe('Fulano');
    expect(created[0]!.options?.body).toBe('oi');
  });

  it('a mention in a DM says who mentioned', async () => {
    notifyIncomingChatMessage(baseEvent({ conversationName: 'Fulano', direct: true, mentioned: true }));
    await vi.runAllTimersAsync();
    expect(created[0]!.title).toBe('Fulano mencionou você');
  });

  it('draws the sender with the channel’s server as a badge', async () => {
    notifyIncomingChatMessage(baseEvent({ server, senderAvatar: '/uploads/fulano', senderAvatarColor: 'teal' }));
    await vi.runAllTimersAsync();
    expect(notificationIcon).toHaveBeenCalledWith(
      { id: 'user-1', name: 'Fulano', src: '/uploads/fulano', color: 'teal', shape: 'circle' },
      { id: 's1', name: 'Clube', src: '/uploads/server', shape: 'squircle' },
    );
    expect(created[0]!.options?.icon).toBe('data:image/png;base64,drawn');
  });

  it('several people in a channel are drawn as the server alone', async () => {
    notifyIncomingChatMessage(baseEvent({ server, senderId: 'user-1', senderName: 'Fulano' }));
    notifyIncomingChatMessage(baseEvent({ server, senderId: 'user-2', senderName: 'Ciclano' }));
    await vi.runAllTimersAsync();
    expect(notificationIcon).toHaveBeenCalledWith({ id: 's1', name: 'Clube', src: '/uploads/server', shape: 'squircle' }, null);
  });
});

describe('notifyIncomingChatMessage — in the desktop app', () => {
  afterEach(() => { delete window.linkordDesktop; });

  it('shows a page notification even with a service worker, and a click brings the window back', async () => {
    const focusWindow = vi.fn(async () => {});
    window.linkordDesktop = { platform: 'darwin', version: '0.1.0', focusWindow };
    const showNotification = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { getRegistration: vi.fn(async () => ({ showNotification })) } });
    const onClick = vi.fn();
    setNotificationClickHandler(onClick);

    notifyIncomingChatMessage(baseEvent());
    await vi.advanceTimersByTimeAsync(3000);

    expect(showNotification).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    created[0]!.onclick?.();
    expect(focusWindow).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalledWith('ch-1');
    setNotificationClickHandler(null);
  });
});

describe('notifyLiveNotice', () => {
  const friendRequest: LiveNotice = {
    kind: 'friend_request', title: 'Fulano quer ser seu amigo', body: '@fulano',
    path: '/app/friends?tab=pending#received', tag: 'social-n1',
  };

  afterEach(() => {
    setNoticeNavigationHandler(null);
    setPushSubscriptionActive(false);
  });

  it('shows the notice as the server words it, at once', async () => {
    notifyLiveNotice(friendRequest);
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe('Fulano quer ser seu amigo');
    expect(created[0]!.options).toMatchObject({ body: '@fulano', tag: 'social-n1', icon: '/icons/icon-192.png' });
    expect(notificationIcon).not.toHaveBeenCalled();
  });

  it('draws the person, and an invitation as its server with the inviter as a badge', async () => {
    const person = { id: 'u1', name: 'Fulano', avatar: '/uploads/fulano', avatarColor: 'teal' };
    notifyLiveNotice({ ...friendRequest, person });
    await vi.runAllTimersAsync();
    expect(notificationIcon).toHaveBeenLastCalledWith({ id: 'u1', name: 'Fulano', src: '/uploads/fulano', color: 'teal', shape: 'circle' }, null);
    expect(created[0]!.options?.icon).toBe('data:image/png;base64,drawn');

    notifyLiveNotice({ ...friendRequest, kind: 'server_invitation', person, server: { id: 's1', name: 'Clube' } });
    await vi.runAllTimersAsync();
    expect(notificationIcon).toHaveBeenLastCalledWith(
      { id: 's1', name: 'Clube', src: undefined, shape: 'squircle' },
      { id: 'u1', name: 'Fulano', src: '/uploads/fulano', color: 'teal', shape: 'circle' },
    );
  });

  it('a click goes to the notice path and brings the desktop window back', async () => {
    const focusWindow = vi.fn(async () => {});
    window.linkordDesktop = { platform: 'win32', version: '0.6.0', focusWindow };
    const navigate = vi.fn();
    setNoticeNavigationHandler(navigate);
    notifyLiveNotice(friendRequest);
    await vi.runAllTimersAsync();
    created[0]!.onclick?.();
    expect(navigate).toHaveBeenCalledWith('/app/friends?tab=pending#received');
    expect(focusWindow).toHaveBeenCalled();
    delete window.linkordDesktop;
  });

  it('a path outside the app falls back to the notifications page', async () => {
    const navigate = vi.fn();
    setNoticeNavigationHandler(navigate);
    notifyLiveNotice({ ...friendRequest, path: 'https://example.com/app/friends' });
    await vi.runAllTimersAsync();
    created[0]!.onclick?.();
    expect(navigate).toHaveBeenCalledWith('/app/notifications');
  });

  it('stays quiet when a push subscription already shows it', async () => {
    setPushSubscriptionActive(true);
    notifyLiveNotice(friendRequest);
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(0);
  });

  it('stays quiet when disabled, in do not disturb, or without permission', async () => {
    setNotificationsModuleEnabled(false);
    notifyLiveNotice(friendRequest);
    setNotificationsModuleEnabled(true);
    setDoNotDisturb(true);
    notifyLiveNotice(friendRequest);
    setDoNotDisturb(false);
    FakeNotification.permission = 'denied';
    notifyLiveNotice(friendRequest);
    FakeNotification.permission = 'granted';
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(0);
  });
});

describe('notifications through the desktop app’s own notifier', () => {
  let clicked: ((id: string) => void) | null;
  let show: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clicked = null;
    show = vi.fn(async () => true);
    window.linkordDesktop = {
      platform: 'darwin', version: '0.7.0', focusWindow: vi.fn(async () => {}),
      notifications: { show, onClick: (callback) => { clicked = callback; return () => { clicked = null; }; } },
    };
  });

  afterEach(() => {
    delete window.linkordDesktop;
    setNotificationClickHandler(null);
    setNoticeNavigationHandler(null);
  });

  it('sends a channel message with its picture, group and sender/channel/text layout', async () => {
    notifyIncomingChatMessage(baseEvent({ conversationName: '#geral · Clube', text: 'oi' }));
    await vi.runAllTimersAsync();
    expect(show).toHaveBeenCalledWith({
      id: 'chat-ch-1', title: '#geral · Clube', body: 'Fulano: oi', icon: 'data:image/png;base64,drawn', group: 'ch-1',
      detail: { sender: 'Fulano', place: '#geral · Clube', text: 'oi' },
    });
    expect(created).toHaveLength(0);
  });

  it('keeps the flat layout for a mention, a DM or a burst', async () => {
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-1', mentioned: true }));
    notifyIncomingChatMessage(baseEvent({ conversationId: 'dm-1', direct: true, conversationName: 'Fulano' }));
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-2' }));
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-2' }));
    await vi.runAllTimersAsync();
    expect(show.mock.calls.map(([request]) => request.detail)).toEqual([null, null, null]);
  });

  it('a click on the system’s notification opens what it was about', async () => {
    const onClick = vi.fn();
    setNotificationClickHandler(onClick);
    notifyIncomingChatMessage(baseEvent());
    await vi.runAllTimersAsync();
    clicked?.('chat-ch-1');
    expect(onClick).toHaveBeenCalledWith('ch-1');
    clicked?.('chat-ch-1');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a notice goes to the social group, without a picture when there is none to draw', async () => {
    const navigate = vi.fn();
    setNoticeNavigationHandler(navigate);
    notifyLiveNotice({ kind: 'friend_accepted', title: 'Fulano aceitou seu pedido', body: '', path: '/app/friends', tag: 'social-n2' });
    await vi.runAllTimersAsync();
    expect(show).toHaveBeenCalledWith({ id: 'social-n2', title: 'Fulano aceitou seu pedido', body: '', icon: null, group: 'social', detail: null });
    clicked?.('social-n2');
    expect(navigate).toHaveBeenCalledWith('/app/friends');
  });

  it('falls back to a web notification when the app does not show it', async () => {
    show.mockResolvedValueOnce(false);
    notifyIncomingChatMessage(baseEvent());
    await vi.runAllTimersAsync();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.tag).toBe('chat-ch-1');
  });
});
