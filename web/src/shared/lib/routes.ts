// Route contract of the app (docs/plano-rede-social.md §5.2). Lives in shared/
// because both app/ (which owns the
// router) and features (sidebar links, profile actions) need the same paths,
// and features must never import app/.

const SETTINGS_TABS = ['profile', 'account', 'av', 'notifications', 'prefs', 'privacy', 'moderation'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function isSettingsTab(value: string | undefined): value is SettingsTab {
  return !!value && (SETTINGS_TABS as readonly string[]).includes(value);
}

/** The views of the unified Friends page. The view lives in the URL
 * (`?tab=`), so history, links and notifications all mean the same thing. */
const FRIENDS_VIEWS = ['all', 'online', 'pending', 'invitations', 'add'] as const;
export type FriendsView = (typeof FRIENDS_VIEWS)[number];
export type FriendsSection = 'received' | 'sent';

/** An unknown or missing value is "everyone" — never an empty page. */
export function parseFriendsView(raw: string | null | undefined): FriendsView {
  return (FRIENDS_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as FriendsView) : 'all';
}

// Discord's URL shapes: `@me` is home (friends and DMs), anything else in
// that slot is a server id.
const HOME = '@me';

export const ROUTES = {
  /** home: the DM list (and, beside it on a wide screen, the friends page) */
  home: '/app/channels/@me',
  /** the friends page on its own — what a phone opens from the DM list */
  friends: '/app/friends',
  notifications: '/app/notifications',
  profile: '/app/profile',
  /** legacy: redirects to the pending view of Friends; new links use friendsView/friendsSection */
  requests: '/app/requests',
  settings: '/app/settings',
  admin: '/admin/users',
  settingsTab: (tab: SettingsTab) => `/app/settings/${tab}`,
  direct: (id: string) => `/app/channels/@me/${encodeURIComponent(id)}`,
  /** a server without a channel: lands on its first visible text channel */
  server: (serverId: string) => `/app/channels/${encodeURIComponent(serverId)}`,
  channel: (serverId: string, channelId: string) => `/app/channels/${encodeURIComponent(serverId)}/${encodeURIComponent(channelId)}`,
  /** a DM call's stage; a voice channel's call shows on its own channel URL */
  call: (id: string) => `/app/calls/${encodeURIComponent(id)}`,
  invite: (code: string) => `/invite/${encodeURIComponent(code)}`,
} as const;

/** Where a conversation lives: a DM under home, a channel under its server. */
export function conversationPath(conversation: { id: string; serverId: string | null }): string {
  return conversation.serverId ? ROUTES.channel(conversation.serverId, conversation.id) : ROUTES.direct(conversation.id);
}

/** Settings and administration open as modals over the app: their URLs name
 * the modal, and the page underneath stays the last real page. */
export type ModalKind = 'settings' | 'admin';

export function modalForPath(pathname: string): ModalKind | null {
  if (pathname === ROUTES.settings || pathname.startsWith(`${ROUTES.settings}/`)) return 'settings';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
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
  const match = /^\/app\/channels\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  return match ? decode(match[2]) : null;
}

/** The server a URL is in; null at home and outside the channels area. */
export function serverIdFromPath(pathname: string): string | null {
  const match = /^\/app\/channels\/([^/]+)(?:\/[^/]*)?\/?$/.exec(pathname);
  const id = match ? decode(match[1]) : null;
  return id && id !== HOME ? id : null;
}

export function callConversationIdFromPath(pathname: string): string | null {
  const match = /^\/app\/calls\/([^/]+)\/?$/.exec(pathname);
  return match ? decode(match[1]) : null;
}

/** Home: the friends page and the DMs. */
export function isHomePath(pathname: string): boolean {
  return pathname === ROUTES.home || pathname.startsWith(`${ROUTES.home}/`) || pathname === ROUTES.friends;
}

export function isChannelsPath(pathname: string): boolean {
  return pathname === '/app/channels' || pathname.startsWith('/app/channels/');
}

export function inviteCodeFromPath(pathname: string): string | null {
  const match = /^\/invite\/([^/]+)\/?$/.exec(pathname);
  return match ? decode(match[1]) : null;
}

/** A new direct conversation is being created before its id is known. */
export const AWAITING_OPEN = { state: { awaitingOpen: true } } as const;

export function isAwaitingOpen(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { awaitingOpen?: unknown }).awaitingOpen === true;
}
