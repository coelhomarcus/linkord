// Shared because the router and feature links need the same paths; features must not import app/.

const SETTINGS_TABS = ['account', 'security', 'connections', 'activity', 'privacy', 'appearance', 'av', 'chat', 'notifications', 'language', 'downloads', 'desktop'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Tabs that were split up: an old link (or a bookmark) still lands on the
 * page that now holds most of what the old tab had. */
export const LEGACY_SETTINGS_TABS: Readonly<Record<string, SettingsTab>> = { prefs: 'appearance' };

/** Sections that became tabs of their own, as `tab#section`: an old link to
 * the section opens the tab that now holds it. */
export const LEGACY_SETTINGS_SECTIONS: Readonly<Record<string, SettingsTab>> = { 'privacy#activity': 'activity' };

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return !!value && (SETTINGS_TABS as readonly string[]).includes(value);
}

/** The views of the unified Friends page. The view lives in the URL
 * (`?tab=`), so history, links and notifications all mean the same thing. */
const FRIENDS_VIEWS = ['all', 'online', 'pending', 'add'] as const;
export type FriendsView = (typeof FRIENDS_VIEWS)[number];
export type FriendsSection = 'received' | 'sent' | 'invitations';

/** An unknown or missing value is "everyone" — never an empty page. */
export function parseFriendsView(raw: string | null | undefined): FriendsView {
  return (FRIENDS_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as FriendsView) : 'all';
}

// Discord's URL shapes: `@me` is home (friends and DMs), anything else in
// that slot is a server id.
const HOME = '@me';

export const ROUTES = {
  /** home: the DM list (and, beside it on a wide screen, the friends page) */
  home: '/channels/@me',
  /** the friends page on its own — what a phone opens from the DM list */
  friends: '/friends',
  notifications: '/notifications',
  /** where the system share sheet lands: choose the conversation for what was shared */
  share: '/share',
  profile: '/profile',
  /** legacy: redirects to the pending view of Friends; new links use friendsView/friendsSection */
  requests: '/requests',
  settings: '/settings',
  settingsTab: (tab: SettingsTab) => `/settings/${tab}`,
  direct: (id: string) => `/channels/@me/${encodeURIComponent(id)}`,
  /** a server without a channel: lands on its first visible text channel */
  server: (serverId: string) => `/channels/${encodeURIComponent(serverId)}`,
  channel: (serverId: string, channelId: string) => `/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(channelId)}`,
  /** a DM call's stage; a voice channel's call shows on its own channel URL */
  call: (id: string) => `/calls/${encodeURIComponent(id)}`,
  invite: (code: string) => `/invite/${encodeURIComponent(code)}`,
} as const;

/** Where a conversation lives: a DM under home, a channel under its server. */
export function conversationPath(conversation: { id: string; serverId: string | null }): string {
  return conversation.serverId ? ROUTES.channel(conversation.serverId, conversation.id) : ROUTES.direct(conversation.id);
}

/** The settings URL opens a modal over the app, and the page underneath stays the last real page. */
export type ModalKind = 'settings';

export function modalForPath(pathname: string): ModalKind | null {
  if (pathname === ROUTES.settings || pathname.startsWith(`${ROUTES.settings}/`)) return 'settings';
  return null;
}

export function friendsView(view: FriendsView, query?: string): string {
  const params = new URLSearchParams();
  if (view !== 'all') params.set('tab', view);
  if (query) params.set('q', query);
  const text = params.toString();
  return text ? `${ROUTES.friends}?${text}` : ROUTES.friends;
}

export function friendsSection(section: FriendsSection): string {
  return `${friendsView('pending')}#${section}`;
}

const decode = (value: string | undefined): string | null => {
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return null; }
};

/** The conversation (DM or channel) a URL shows. */
export function conversationIdFromPath(pathname: string): string | null {
  const match = /^\/channels\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  return match ? decode(match[2]) : null;
}

/** The server a URL is in; null at home and outside the channels area. */
export function serverIdFromPath(pathname: string): string | null {
  const match = /^\/channels\/([^/]+)(?:\/[^/]*)?\/?$/.exec(pathname);
  const id = match ? decode(match[1]) : null;
  return id && id !== HOME ? id : null;
}

export function callConversationIdFromPath(pathname: string): string | null {
  const match = /^\/calls\/([^/]+)\/?$/.exec(pathname);
  return match ? decode(match[1]) : null;
}

/** Home: the friends page and the DMs. */
export function isHomePath(pathname: string): boolean {
  return pathname === ROUTES.home || pathname.startsWith(`${ROUTES.home}/`) || pathname === ROUTES.friends;
}

export function isChannelsPath(pathname: string): boolean {
  return pathname === '/channels' || pathname.startsWith('/channels/');
}

export function inviteCodeFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  return match ? decode(match[1]) : null;
}

// a message's msgId, a positive safe integer
const MESSAGE_ID = /^[1-9][0-9]{0,14}$/;

/** A link to a message is its conversation's URL with `?message=<msgId>`:
 * the conversation opens at that message. */
export function messageIdFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get('message');
  return raw && MESSAGE_ID.test(raw) ? Number(raw) : null;
}

/** Whether a path the desktop app hands over for a `overcord://` link
 * (desktop/src/main/deepLink.ts builds it) is one it may open: an invite, or
 * a conversation, optionally at a message. Never anything else in the app. */
export function isDesktopLinkPath(path: string): boolean {
  return /^\/invite\/[A-Za-z0-9]{4,16}$/.test(path)
    || /^\/channels\/[A-Za-z0-9_@-]{1,64}\/[A-Za-z0-9_-]{1,64}(?:\?message=[1-9][0-9]{0,14})?$/.test(path);
}

// The app lived under `/app` until it moved to the root. The server redirects
// those URLs; these cover the paths that reach the app without a page load:
// an older service worker's push click, an older desktop app's deep link.
const LEGACY_APP_PREFIX = /^\/app(?=[/?#]|$)/;
// what the server answers itself, never a page of the app (server/src/http/app.ts)
const SERVER_PATH = /^\/(?:api|uploads|ws|admin)(?:\/|$)/;
const ROUTE_ORIGIN = 'https://overcord.invalid';

/** The path without the old `/app` prefix; any other path as it is. */
export function withoutLegacyAppPrefix(path: string): string {
  if (!LEGACY_APP_PREFIX.test(path)) return path;
  // '/app//host' must not turn into the protocol-relative '//host'
  return `/${path.replace(LEGACY_APP_PREFIX, '').replace(/^[/\\]+/, '')}`;
}

/** A page of the app named by a notice or a push, old prefix or not, or
 * null for anything that would leave the app. */
export function inAppPath(raw: string): string | null {
  if (!raw.startsWith('/') || /^\/[/\\]/.test(raw)) return null;
  try {
    const path = new URL(withoutLegacyAppPrefix(raw), ROUTE_ORIGIN);
    if (path.origin !== ROUTE_ORIGIN || SERVER_PATH.test(path.pathname)) return null;
    return path.pathname + path.search + path.hash;
  } catch {
    return null;
  }
}

/** A new direct conversation is being created before its id is known. */
export const AWAITING_OPEN = { state: { awaitingOpen: true } } as const;

export function isAwaitingOpen(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { awaitingOpen?: unknown }).awaitingOpen === true;
}
