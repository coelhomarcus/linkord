
import type { ChatAttachment, InvitationCard, PublicUser } from '@/shared/types/protocol';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { logger } from '@/shared/lib/logger';
import { i18n } from '@/shared/i18n/init';
import type { Language } from '@/shared/i18n/languages';

const log = logger.child({ component: 'api' });

export interface ApiUser {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  avatar: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
  locale: Language;
}

export class ApiError extends Error {
  status: number;
  code: string;
  // only the friend-request cooldown response carries this
  retryAfter?: string;
  constructor(status: number, code: string, message: string, retryAfter?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    // Only when there IS a body — Fastify's default JSON parser 400s a
    // request that declares Content-Type: application/json but sends an
    // empty body (e.g. POST /api/auth/logout), which used to fail silently
    // (swallowed by AuthContext's logout() try/catch) and leave the real
    // session cookie alive on the server after a client-side "logout".
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers || {}) },
  });

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try { body = await res.json(); } catch {  }

  if (!res.ok) {
    const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string; retryAfter?: string } }).error : null) || {};
    // expected 4xx answers (validation, cooldowns, denials) are normal control flow;
    // a server failure is worth a record, and a report
    if (res.status >= 500) log.error('API request failed', undefined, { path: path.split('?')[0], method: init?.method ?? 'GET', status: res.status, code: err.code });
    throw new ApiError(res.status, err.code || 'unknown_error', err.message || i18n.t('errors.unexpected'), err.retryAfter);
  }
  return body as T;
}

export function fetchMe(): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/me');
}

/** A login with two-step verification on answers with a challenge instead of the account: the session
 * only exists once the emailed code comes back with it (`verifyLoginCode`). */
export interface LoginChallenge {
  challenge: string;
  /** the account email, masked (`a***@example.com`) */
  email: string;
}

/** `deletionCancelled`: this sign-in cancelled the account's scheduled deletion. */
export interface SignedIn { user: ApiUser; deletionCancelled?: true }

export function login(username: string, password: string): Promise<SignedIn | { twoFactor: LoginChallenge }> {
  return apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function verifyLoginCode(challenge: string, code: string): Promise<SignedIn> {
  return apiFetch('/api/auth/login/verify', { method: 'POST', body: JSON.stringify({ challenge, code }) });
}

export function resendLoginCode(challenge: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/login/resend', { method: 'POST', body: JSON.stringify({ challenge }) });
}

export interface SecurityStatus {
  twoFactorEnabled: boolean;
  /** email when a browser the account has not used lately signs in */
  loginAlertEnabled: boolean;
  /** false when the server has no email delivery: two-step login cannot be turned on */
  emailDeliveryAvailable: boolean;
  hasEmail: boolean;
  /** days without use after which a session ends; 0 = never */
  sessionIdleDays: number;
}

export function fetchSecurityStatus(): Promise<SecurityStatus> {
  return apiFetch('/api/auth/security');
}

/** A code sent to the account's current email, which the matching confirm call takes. With two-step login on,
 * that email is the second factor of every change that could take it away. */
export interface CurrentEmailCodeSent { codeRequired: true; email: string }

/** Turning them on asks nothing; turning them off asks the password and, with two-step login on, a code
 * (`confirmLoginAlertDisable`). */
export function setLoginAlerts(enabled: boolean, password?: string): Promise<{ loginAlertEnabled: boolean } | CurrentEmailCodeSent> {
  return apiFetch('/api/auth/login-alerts', { method: 'PUT', body: JSON.stringify({ enabled, password }) });
}

export function confirmLoginAlertDisable(code: string): Promise<{ loginAlertEnabled: boolean }> {
  return apiFetch('/api/auth/login-alerts/disable/confirm', { method: 'POST', body: JSON.stringify({ code }) });
}

export function requestTwoFactorEnable(password: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/two-factor/enable/request', { method: 'POST', body: JSON.stringify({ password }) });
}

export function confirmTwoFactorEnable(code: string): Promise<{ twoFactorEnabled: boolean }> {
  return apiFetch('/api/auth/two-factor/enable/confirm', { method: 'POST', body: JSON.stringify({ code }) });
}

/** The password earns a code to the account email (`confirmTwoFactorDisable`); already off, it answers so. */
export function disableTwoFactor(password: string): Promise<{ twoFactorEnabled: boolean } | CurrentEmailCodeSent> {
  return apiFetch('/api/auth/two-factor/disable', { method: 'POST', body: JSON.stringify({ password }) });
}

export function confirmTwoFactorDisable(code: string): Promise<{ twoFactorEnabled: boolean }> {
  return apiFetch('/api/auth/two-factor/disable/confirm', { method: 'POST', body: JSON.stringify({ code }) });
}

/** Keeps this session and ends every other one. */
export function changePassword(currentPassword: string, newPassword: string): Promise<{ endedSessions: number }> {
  return apiFetch('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
}

export interface AccountSession {
  id: string;
  current: boolean;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
}

export function fetchSessions(): Promise<{ sessions: AccountSession[] }> {
  return apiFetch('/api/auth/sessions');
}

export function endSession(id: string): Promise<void> {
  return apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function endOtherSessions(): Promise<{ endedSessions: number }> {
  return apiFetch('/api/auth/sessions/end-others', { method: 'POST' });
}

export function register(username: string, email: string, password: string, confirmPassword: string, code: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, confirmPassword, code, locale: i18n.language }) });
}

export function updateLocale(locale: Language): Promise<{ locale: Language }> {
  return apiFetch('/api/me/locale', { method: 'PATCH', body: JSON.stringify({ locale }) });
}

export type RecoveryIdentifier = { type: 'email'; value: string } | { type: 'username'; value: string };

function identifierPayload(identifier: RecoveryIdentifier): { email: string } | { username: string } {
  return identifier.type === 'email' ? { email: identifier.value } : { username: identifier.value };
}

export function requestPasswordRecovery(identifier: RecoveryIdentifier): Promise<{ ok: true }> {
  return apiFetch('/api/auth/recovery/request', { method: 'POST', body: JSON.stringify(identifierPayload(identifier)) });
}

export function resetPassword(identifier: RecoveryIdentifier, code: string, password: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/recovery/reset', { method: 'POST', body: JSON.stringify({ ...identifierPayload(identifier), code, password }) });
}

export interface UsernameAvailability {
  username: string;
  /** free for this account: nobody else has it in any letter case (the account's own name is free) */
  available: boolean;
  /** exactly the account's current name, so there is nothing to change */
  current: boolean;
}

export function checkUsernameAvailability(username: string, signal?: AbortSignal): Promise<UsernameAvailability> {
  return apiFetch(`/api/auth/username/availability?username=${encodeURIComponent(username)}`, { signal });
}

export function changeUsername(username: string, password: string): Promise<{ user: ApiUser }> {
  return apiFetch('/api/auth/username', { method: 'POST', body: JSON.stringify({ username, password }) });
}

/** `{ ok }`: a code went to the new address (`confirmEmailChange`). With two-step login on, a code goes to the
 * current address first (`verifyEmailChangeCurrent`), which earns the one to the new address. */
export function requestEmailChange(email: string, password: string): Promise<{ ok: true } | CurrentEmailCodeSent> {
  return apiFetch('/api/auth/email/change/request', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function verifyEmailChangeCurrent(email: string, code: string): Promise<{ ok: true }> {
  return apiFetch('/api/auth/email/change/verify-current', { method: 'POST', body: JSON.stringify({ email, code }) });
}

/** Moves the address and signs every other session out. */
export function confirmEmailChange(email: string, code: string): Promise<{ user: ApiUser; endedSessions?: number }> {
  return apiFetch('/api/auth/email/change/confirm', { method: 'POST', body: JSON.stringify({ email, code }) });
}

/** Deleting your own account: with two-step login on, the password earns an emailed code first
 * (`confirmAccountDeletion`); otherwise the deletion is scheduled at once. Either way the account is then
 * signed out everywhere, this browser included. */
export function requestAccountDeletion(password: string): Promise<{ deletionDueAt: string } | CurrentEmailCodeSent> {
  return apiFetch('/api/auth/account/deletion/request', { method: 'POST', body: JSON.stringify({ password }) });
}

export function confirmAccountDeletion(code: string): Promise<{ deletionDueAt: string }> {
  return apiFetch('/api/auth/account/deletion/confirm', { method: 'POST', body: JSON.stringify({ code }) });
}

export interface DataExport {
  id: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'expired';
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
}

/** The latest copy of the account's data, and when another may be asked for (null: now). */
export interface DataExportStatus { latest: DataExport | null; nextRequestAt: string | null }

export function fetchDataExportStatus(): Promise<DataExportStatus> {
  return apiFetch('/api/account/data-export');
}

export function requestDataExport(): Promise<{ export: DataExport }> {
  return apiFetch('/api/account/data-export', { method: 'POST' });
}

export const dataExportDownloadUrl = (id: string) => `/api/account/data-export/${encodeURIComponent(id)}/download`;

export function logout(): Promise<void> {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

/** uploads is every file ("Todos"); embeds is the shared links */
export type MediaKind = 'uploads' | 'images' | 'videos' | 'audios' | 'documents' | 'gifs' | 'embeds';

export interface MediaItem {
  msgId: number;
  conversationId: string;
  conversationName: string;
  authorId: string | null;
  authorName: string;
  authorAvatar: string;
  authorAvatarColor: string;
  ts: number;
  attachment?: ChatAttachment;
  embed?: DetectedEmbed;
  /** a direct image link's picture through the media proxy; absent from an
   * older server and for GIFs */
  imageUrl?: string | null;
}

export interface MediaPage {
  items: MediaItem[];
  nextBefore: number | null;
}

export function fetchMedia(kind: MediaKind, before: number | null, conversationId: string, q = '', limit = 24): Promise<MediaPage> {
  const params = new URLSearchParams({ kind, limit: String(limit), conversationId });
  if (q) params.set('q', q);
  if (before != null) params.set('before', String(before));
  return apiFetch(`/api/media?${params.toString()}`);
}

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  video: string | null;
  favicon: string | null;
  siteName: string;
  themeColor: string | null;
  /** pixel size of `image` as the server measured it; absent or null when unknown */
  imageWidth?: number | null;
  imageHeight?: number | null;
  // Absent on previews stored before protocol 21 (see LinkPreviewResult in
  // server/src/modules/link-preview/preview.ts).
  type?: 'link' | 'article' | 'image' | 'video' | 'audio';
  images?: string[];
  imageAlt?: string | null;
  /** base64 ThumbHash of `image`, to paint while it loads (protocol 22) */
  imagePlaceholder?: string | null;
  audio?: string | null;
  /** a player page on an allowlisted host, for an iframe */
  player?: string | null;
  authorName?: string | null;
  authorUrl?: string | null;
}

/** The KLIPY key and this account's customer id, for the GIF picker to call
 * KLIPY from the browser (their terms rule out proxying it through us). */
export type GifConfig = { enabled: false } | { enabled: true; apiKey: string; customerId: string };

export function fetchGifConfig(): Promise<GifConfig> {
  return apiFetch('/api/gifs/config');
}

export function fetchLinkPreview(url: string): Promise<LinkPreviewData> {
  return apiFetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
}

/** Fetch a profile missing from the known-users cache. A 404 covers both nonexistent and
 * unauthorized accounts, so this endpoint does not reveal relationship state. */
export function fetchUserProfile(userId: string): Promise<{ user: PublicUser }> {
  return apiFetch(`/api/users/${userId}/profile`);
}

// ---- friends, requests, and blocks ------------------------------------------

/** The minimum a friends/requests/blocks row needs — no banner/bio, the
 * server never sends a full profile to someone not yet authorized to see one. */
export interface SocialUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
}

/** A server two accounts are both members of, as a profile lists it. */
interface SharedServer { id: string; name: string; icon: string; memberCount: number }

/** What a profile shows besides the profile itself. The lists stop at a cap;
 * `total` is the full count. Empty, with no `friendsSince`, on your own profile. */
export interface ProfileDetails {
  memberSince: string;
  friendsSince: string | null;
  mutualFriends: { items: SocialUser[]; total: number };
  mutualServers: { items: SharedServer[]; total: number };
}

/** Same access, and the same 404 for "no" and "doesn't exist", as fetchUserProfile. */
export function fetchProfileDetails(userId: string, signal?: AbortSignal): Promise<ProfileDetails> {
  return apiFetch(`/api/users/${userId}/profile-details`, { signal });
}

export interface SocialEntry { user: SocialUser; at: string }
export interface SocialPage { items: SocialEntry[]; nextCursor: string | null }

export type Relation = 'self' | 'none' | 'friends' | 'outgoing' | 'incoming' | 'blocked';
export interface Relationship { relation: Relation; retryAfter: string | null }

function pageQuery(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) q.set(key, value);
  const text = q.toString();
  return text ? `?${text}` : '';
}

export function fetchFriends(cursor: string | null, q: string, status?: 'online'): Promise<SocialPage> {
  return apiFetch(`/api/friends${pageQuery({ cursor, q, status })}`);
}

export function fetchFriendRequests(direction: 'incoming' | 'outgoing', cursor: string | null, q?: string): Promise<SocialPage> {
  return apiFetch(`/api/friend-requests${pageQuery({ direction, cursor, q })}`);
}

export function fetchRequestSummary(): Promise<{ incoming: number; invitations: number }> {
  return apiFetch('/api/friend-requests/summary');
}

export function fetchBlocks(cursor: string | null): Promise<SocialPage> {
  return apiFetch(`/api/blocks${pageQuery({ cursor })}`);
}

export function fetchRelationship(userId: string): Promise<Relationship> {
  return apiFetch(`/api/relationships/${encodeURIComponent(userId)}`);
}

export type FriendRequestOutcome = 'created' | 'already_friends' | 'already_pending' | 'pending_received';

interface FriendRequestResponse { friendship: { status: string }; direction?: 'outgoing' | 'incoming' }

/** Sends a request by exact username. The server answers 201/200 with the
 * same body shape, so the outcome is derived from the body — `direction` says
 * a request was already pending (either way), an accepted status says the two
 * are already friends, anything else is a fresh request. */
export async function sendFriendRequest(username: string): Promise<FriendRequestOutcome> {
  const res = await apiFetch<FriendRequestResponse>('/api/friend-requests', { method: 'POST', body: JSON.stringify({ username }) });
  if (res.direction === 'incoming') return 'pending_received';
  if (res.direction === 'outgoing') return 'already_pending';
  return res.friendship.status === 'accepted' ? 'already_friends' : 'created';
}

export function acceptFriendRequest(userId: string): Promise<unknown> {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(userId)}/accept`, { method: 'POST' });
}

export function declineFriendRequest(userId: string): Promise<unknown> {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(userId)}/decline`, { method: 'POST' });
}

export function cancelFriendRequest(userId: string): Promise<unknown> {
  return apiFetch(`/api/friend-requests/${encodeURIComponent(userId)}/cancel`, { method: 'POST' });
}

export function removeFriend(userId: string): Promise<unknown> {
  return apiFetch(`/api/friendships/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

export function blockUser(userId: string): Promise<unknown> {
  return apiFetch(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'POST' });
}

export function unblockUser(userId: string): Promise<unknown> {
  return apiFetch(`/api/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

// ---- server invitations (a friend's card in a DM) ---------------------------

export type InviteOutcome = 'sent' | 'already_pending' | 'already_member' | 'not_friends' | 'server_full' | 'banned' | 'unavailable';
export interface InviteResult { userId: string; outcome: InviteOutcome; invitationId?: string }

export interface ReceivedInvitationEntry {
  id: string;
  at: string;
  server: { id: string; name: string; icon: string; memberCount: number };
  inviter: SocialUser;
}

export function inviteToServer(serverId: string, userIds: string[]): Promise<{ results: InviteResult[] }> {
  return apiFetch(`/api/servers/${encodeURIComponent(serverId)}/invitations`, { method: 'POST', body: JSON.stringify({ userIds }) });
}

/** Asks a member who can join a voice channel to come in, as a card in your DM with them. */
export function inviteToCall(conversationId: string, userId: string): Promise<{ ok: true }> {
  return apiFetch(`/api/calls/${encodeURIComponent(conversationId)}/invites`, { method: 'POST', body: JSON.stringify({ userId }) });
}

export function fetchReceivedInvitations(cursor: string | null, q?: string): Promise<{ items: ReceivedInvitationEntry[]; nextCursor: string | null }> {
  return apiFetch(`/api/server-invitations${pageQuery({ cursor, q })}`);
}

// ---- notifications (bell) ----------------------------------------------------

type NotificationKind = 'friend_request' | 'friend_accepted' | 'server_invitation' | 'mention';
export interface NotificationEntry {
  id: string;
  kind: NotificationKind;
  at: string;
  read: boolean;
  friendshipId: string | null;
  invitationId: string | null;
  actor: SocialUser | null;
  server: { id: string; name: string; icon: string } | null;
  // only for mentions: where it was and the start of what was said
  mention?: {
    messageId: number; excerpt: string;
    conversation: { id: string; type: 'direct' | 'text' | 'voice'; name: string; serverId: string | null; serverName: string; serverIcon: string };
  } | null;
}

export function fetchNotifications(cursor: string | null): Promise<{ items: NotificationEntry[]; nextCursor: string | null }> {
  return apiFetch(`/api/notifications${pageQuery({ cursor })}`);
}

export function fetchUnreadNotificationCount(): Promise<{ unread: number }> {
  return apiFetch('/api/notifications/summary');
}

export function deleteNotification(id: string): Promise<{ deleted: number }> {
  return apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function clearNotifications(): Promise<{ deleted: number }> {
  return apiFetch('/api/notifications', { method: 'DELETE' });
}

export function markNotificationsRead(input: { ids: string[] } | { all: true }): Promise<{ marked: number }> {
  return apiFetch('/api/notifications/read', { method: 'POST', body: JSON.stringify(input) });
}

export function acceptInvitation(id: string): Promise<{ invitation: InvitationCard }> {
  return apiFetch(`/api/server-invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

export function declineInvitation(id: string): Promise<{ invitation: InvitationCard }> {
  return apiFetch(`/api/server-invitations/${encodeURIComponent(id)}/decline`, { method: 'POST' });
}

export function revokeInvitation(id: string): Promise<{ invitation: InvitationCard }> {
  return apiFetch(`/api/server-invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---- reports ----------------------------------------------------------------

export function submitReport(input: { targetType: 'user' | 'server' | 'message'; targetId: string; category: string; details: string }): Promise<{ ok: true }> {
  return apiFetch('/api/reports', { method: 'POST', body: JSON.stringify(input) });
}

