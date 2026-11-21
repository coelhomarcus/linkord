import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyIncomingChatMessage, notifyLiveNotice, setNoticeNavigationHandler, setNotificationClickHandler, setNotificationsModuleEnabled, setPushSubscriptionActive } from '@/shared/notifications';
import type { LiveNotice } from '@/shared/types/protocol';
import type { IncomingChatEvent } from '@/shared/notifications';
import { setDoNotDisturb } from '@/shared/doNotDisturb';

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
    senderId: 'user-1',
    senderName: 'Fulano',
    text: 'oi',
    mentioned: false,
    ...overrides,
  };
}

beforeEach(() => {
  created = [];
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
  it('does not create a notification when the module is disabled', () => {
    setNotificationsModuleEnabled(false);
    notifyIncomingChatMessage(baseEvent());
    vi.runAllTimers();
    expect(created).toHaveLength(0);
  });

  it('does not create a notification in do not disturb', () => {
    setDoNotDisturb(true);
    notifyIncomingChatMessage(baseEvent());
    vi.runAllTimers();
    setDoNotDisturb(false);
    expect(created).toHaveLength(0);
  });

  it('does not create a notification without permission granted', () => {
    FakeNotification.permission = 'default';
    notifyIncomingChatMessage(baseEvent());
    vi.runAllTimers();
    expect(created).toHaveLength(0);
    FakeNotification.permission = 'granted';
  });

  it('a single message generates "Sender: text"', () => {
    notifyIncomingChatMessage(baseEvent({ senderName: 'Fulano', text: 'oi pessoal' }));
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('Fulano: oi pessoal');
    expect(created[0]!.options?.tag).toBe('chat-ch-1');
  });

  it('a quick burst from the same sender in the same channel collapses into ONE notification', () => {
    for (let i = 0; i < 6; i++) {
      notifyIncomingChatMessage(baseEvent({ text: `mensagem ${i}` }));
      vi.advanceTimersByTime(200);
    }
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('Fulano enviou 6 mensagens');
  });

  it('a burst with different senders in the same channel collapses by citing the number of people', () => {
    notifyIncomingChatMessage(baseEvent({ senderId: 'user-1', senderName: 'Fulano' }));
    vi.advanceTimersByTime(200);
    notifyIncomingChatMessage(baseEvent({ senderId: 'user-2', senderName: 'Ciclano' }));
    vi.runAllTimers();
    expect(created).toHaveLength(1);
    expect(created[0]!.options?.body).toBe('2 pessoas enviaram mensagens');
  });

  it('different conversations do not mix (buffer per conversation)', () => {
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-1' }));
    notifyIncomingChatMessage(baseEvent({ conversationId: 'ch-2' }));
    vi.runAllTimers();
    expect(created).toHaveLength(2);
    expect(created.map((n) => n.options?.tag).sort()).toEqual(['chat-ch-1', 'chat-ch-2']);
  });

  it('a continuous burst (no pause) still fires periodically (MAX_WAIT)', () => {
    for (let i = 0; i < 40; i++) {
      notifyIncomingChatMessage(baseEvent({ text: `m${i}` }));
      vi.advanceTimersByTime(300);
    }
    expect(created.length).toBeGreaterThan(0);
  });

  it('a message with a mention uses a distinct title', () => {
    notifyIncomingChatMessage(baseEvent({ mentioned: true }));
    vi.runAllTimers();
    expect(created[0]!.title).toBe('Você foi mencionado em geral');
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
    vi.advanceTimersByTime(3000);

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

  it('shows the notice as the server words it, at once', () => {
    notifyLiveNotice(friendRequest);
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe('Fulano quer ser seu amigo');
    expect(created[0]!.options).toMatchObject({ body: '@fulano', tag: 'social-n1', icon: '/icons/icon-192.png' });
  });

  it('a click goes to the notice path and brings the desktop window back', () => {
    const focusWindow = vi.fn(async () => {});
    window.linkordDesktop = { platform: 'win32', version: '0.6.0', focusWindow };
    const navigate = vi.fn();
    setNoticeNavigationHandler(navigate);
    notifyLiveNotice(friendRequest);
    created[0]!.onclick?.();
    expect(navigate).toHaveBeenCalledWith('/app/friends?tab=pending#received');
    expect(focusWindow).toHaveBeenCalled();
    delete window.linkordDesktop;
  });

  it('a path outside the app falls back to the notifications page', () => {
    const navigate = vi.fn();
    setNoticeNavigationHandler(navigate);
    notifyLiveNotice({ ...friendRequest, path: 'https://example.com/app/friends' });
    created[0]!.onclick?.();
    expect(navigate).toHaveBeenCalledWith('/app/notifications');
  });

  it('stays quiet when a push subscription already shows it', () => {
    setPushSubscriptionActive(true);
    notifyLiveNotice(friendRequest);
    expect(created).toHaveLength(0);
  });

  it('stays quiet when disabled, in do not disturb, or without permission', () => {
    setNotificationsModuleEnabled(false);
    notifyLiveNotice(friendRequest);
    setNotificationsModuleEnabled(true);
    setDoNotDisturb(true);
    notifyLiveNotice(friendRequest);
    setDoNotDisturb(false);
    FakeNotification.permission = 'denied';
    notifyLiveNotice(friendRequest);
    FakeNotification.permission = 'granted';
    expect(created).toHaveLength(0);
  });
});
