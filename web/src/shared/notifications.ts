
import { i18n } from '@/shared/i18n/init';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { isDoNotDisturb } from '@/shared/doNotDisturb';
import { desktopApp, isDesktopApp, type DesktopNotifications } from '@/shared/desktop';
import type { LiveNotice } from '@/shared/types/protocol';
import { FALLBACK_NOTIFICATION_ICON, notificationIcon, type NoticePicture } from '@/shared/notificationIcon';

export function loadNotificationsEnabled(): boolean {
  const stored = localStorageStore.get(LOCAL_STORAGE_KEYS.notificationsEnabled);
  return stored === null ? true : stored === '1';
}

export function saveNotificationsEnabled(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.notificationsEnabled, value ? '1' : '0');
}

/** The browser's own permission and the Linkord preference are different
 * things — this only ever reads the former. `'unsupported'`: no
 * Notification API at all (never happens for the preference, which is
 * still a normal on/off in localStorage either way). */
export type NotificationPermissionState = 'unsupported' | NotificationPermission;

export function notificationPermissionState(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

let enabled = false;
let pushSubscriptionActive = false;
export function setNotificationsModuleEnabled(value: boolean): void {
  enabled = value;
}

export function setPushSubscriptionActive(value: boolean): void {
  if (pushSubscriptionActive === value) return;
  pushSubscriptionActive = value;
  window.dispatchEvent(new Event('linkord-push-changed'));
}

export function isPushSubscriptionActive(): boolean { return pushSubscriptionActive; }

let onClick: ((conversationId: string) => void) | null = null;
export function setNotificationClickHandler(fn: ((conversationId: string) => void) | null): void {
  onClick = fn;
}

let onNavigate: ((path: string) => void) | null = null;
/** Where a click on a notice (`notifyLiveNotice`) goes: an app path, already checked. */
export function setNoticeNavigationHandler(fn: ((path: string) => void) | null): void {
  onNavigate = fn;
}

function canShowNotifications(): boolean {
  if (!enabled || isDoNotDisturb()) return false;
  // a subscribed browser gets the same notice as a push, which shows even with every tab closed
  if (pushSubscriptionActive) return false;
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

interface Buffered {
  conversationName: string;
  direct: boolean;
  server: NoticePicture | null;
  senders: Map<string, { name: string; count: number }>;
  lastSender: NoticePicture;
  lastText: string;
  count: number;
  mentioned: boolean;
  firstAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const buffers = new Map<string, Buffered>();

const QUIET_MS = 2000;
const MAX_WAIT_MS = 6000;
const BODY_TEXT_LIMIT = 120;

export interface IncomingChatEvent {
  conversationId: string;
  /** a DM: the other person's name; a channel: `#channel · Server` */
  conversationName: string;
  direct: boolean;
  /** the channel's server, drawn as a badge on the sender's picture */
  server?: { id: string; name: string; icon: string } | null;
  senderId: string | null;
  senderName: string;
  senderAvatar?: string;
  senderAvatarColor?: string | null;
  text: string;
  mentioned: boolean;
}

export function notifyIncomingChatMessage(evt: IncomingChatEvent): void {
  if (!canShowNotifications()) return;

  const key = evt.senderId ?? '?';
  const conversationId = evt.conversationId;
  const picture: NoticePicture = {
    id: evt.senderId ?? evt.senderName, name: evt.senderName, src: evt.senderAvatar, color: evt.senderAvatarColor, shape: 'circle',
  };
  let buf = buffers.get(conversationId);
  if (!buf) {
    buf = {
      conversationName: evt.conversationName,
      direct: evt.direct,
      server: evt.server ? { id: evt.server.id, name: evt.server.name, src: evt.server.icon, shape: 'squircle' } : null,
      senders: new Map(),
      lastSender: picture,
      lastText: evt.text,
      count: 0,
      mentioned: false,
      firstAt: Date.now(),
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    };
    buffers.set(conversationId, buf);
  }
  buf.count++;
  buf.lastSender = picture;
  buf.lastText = evt.text;
  buf.mentioned = buf.mentioned || evt.mentioned;
  const sender = buf.senders.get(key);
  if (sender) sender.count++;
  else buf.senders.set(key, { name: evt.senderName, count: 1 });

  clearTimeout(buf.timer);
  const elapsed = Date.now() - buf.firstAt;
  const delay = Math.min(QUIET_MS, Math.max(0, MAX_WAIT_MS - elapsed));
  buf.timer = setTimeout(() => flush(conversationId), delay);
}

function flush(conversationId: string): void {
  const buf = buffers.get(conversationId);
  if (!buf) return;
  buffers.delete(conversationId);

  const senderName = buf.lastSender.name;
  const title = !buf.mentioned ? buf.conversationName
    : buf.direct ? i18n.t('browserNotifications.mentionedDirect', { name: senderName })
      : i18n.t('browserNotifications.mentioned', { conversation: buf.conversationName });
  let body: string;
  if (buf.count === 1) {
    const text = buf.lastText.slice(0, BODY_TEXT_LIMIT);
    // in a DM the title already names the sender, as the push words it
    body = buf.direct ? text : `${senderName}: ${text}`;
  } else if (buf.senders.size === 1) {
    body = i18n.t(buf.count === 1 ? 'browserNotifications.sentMessages_one' : 'browserNotifications.sentMessages_other', { name: senderName, count: buf.count });
  } else {
    body = i18n.t(buf.senders.size === 1 ? 'browserNotifications.peopleSent_one' : 'browserNotifications.peopleSent_other', { count: buf.senders.size });
  }

  // several people in a channel: the server alone, since no one face stands for them
  const [main, badge] = buf.senders.size > 1 && buf.server ? [buf.server, null] : [buf.lastSender, buf.server];
  void notificationIcon(main, badge).then((icon) => show(title, {
    body,
    icon,
    badge: '/icons/notification-badge-96.png',
    tag: `chat-${conversationId}`,
    data: { path: `/app/conversations/${encodeURIComponent(conversationId)}` },
  }, () => onClick?.(conversationId), conversationId)).catch(() => {});
}

/** A friend request, an accepted request or a server invitation, as the server words it. */
export function notifyLiveNotice(notice: LiveNotice): void {
  if (!canShowNotifications()) return;
  // the server only sends app paths; anything else would make a click leave the app
  const path = notice.path.startsWith('/app/') ? notice.path : '/app/notifications';
  const person: NoticePicture | null = notice.person
    ? { id: notice.person.id, name: notice.person.name, src: notice.person.avatar, color: notice.person.avatarColor, shape: 'circle' }
    : null;
  const server: NoticePicture | null = notice.server
    ? { id: notice.server.id, name: notice.server.name, src: notice.server.icon, shape: 'squircle' }
    : null;
  // an invitation is about the server; the inviter is the badge
  const [main, badge] = notice.kind === 'server_invitation' && server ? [server, person] : [person, null];
  const icon = main ? notificationIcon(main, badge) : Promise.resolve(FALLBACK_NOTIFICATION_ICON);
  void icon.then((resolved) => show(notice.title, {
    body: notice.body,
    icon: resolved,
    badge: '/icons/notification-badge-96.png',
    tag: notice.tag,
    data: { path },
  }, () => onNavigate?.(path), 'social')).catch(() => {});
}

/** `group`: the desktop app stacks a conversation's toasts together (`social` for the notices). */
function show(title: string, options: NotificationOptions, onShownClick: () => void, group: string | null = null): void {
  const desktop = desktopApp()?.notifications;
  if (desktop && options.tag) {
    showOnDesktop(desktop, title, { ...options, tag: options.tag }, onShownClick, group);
    return;
  }
  // An older desktop app shows page notifications as the system's; a service
  // worker's would need a push service it does not have
  if ('serviceWorker' in navigator && !isDesktopApp()) {
    void navigator.serviceWorker.getRegistration('/').then((registration) => {
      if (registration) return registration.showNotification(title, options);
      showPageNotification(title, options, onShownClick);
    }).catch(() => {});
  } else {
    showPageNotification(title, options, onShownClick);
  }
}

// Clicks come back by id, after the main process brought the window back
const desktopClicks = new Map<string, () => void>();
const MAX_DESKTOP_CLICKS = 100;
let listeningTo: DesktopNotifications | null = null;
let stopListening: (() => void) | null = null;

function showOnDesktop(desktop: DesktopNotifications, title: string, options: NotificationOptions & { tag: string }, onShownClick: () => void, group: string | null): void {
  if (listeningTo !== desktop) {
    stopListening?.();
    listeningTo = desktop;
    stopListening = desktop.onClick((id) => {
      const handler = desktopClicks.get(id);
      desktopClicks.delete(id);
      handler?.();
    });
  }
  const id = options.tag;
  desktopClicks.delete(id);
  desktopClicks.set(id, onShownClick);
  if (desktopClicks.size > MAX_DESKTOP_CLICKS) desktopClicks.delete(desktopClicks.keys().next().value!);
  const fallback = () => {
    desktopClicks.delete(id);
    showPageNotification(title, options, onShownClick);
  };
  void desktop.show({
    id,
    title,
    body: options.body ?? '',
    // the app icon is the system's default there; only a picture the page drew is worth sending
    icon: typeof options.icon === 'string' && options.icon.startsWith('data:') ? options.icon : null,
    group,
  }).then((shown) => { if (!shown) fallback(); }, fallback);
}

function showPageNotification(title: string, options: NotificationOptions, onShownClick: () => void): void {
  const notif = new Notification(title, options);
  notif.onclick = () => {
    window.focus();
    // a hidden desktop window (closed on macOS) does not come back from window.focus()
    void desktopApp()?.focusWindow?.().catch(() => {});
    onShownClick();
    notif.close();
  };
}
