import { ApiError, apiFetch } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { reportAdminAccessLost, reportAdminSessionEnded } from './adminAccess';
import { invalidateAdminLists } from './adminListCache';

// The server enforces access; hiding admin routes in the UI is not authorization.

export interface Page<T> { items: T[]; nextCursor: string | null }

/** apiFetch plus two rules, so the area reacts as a whole instead of each page
 * showing its own error: a 403 `forbidden` means the server no longer sees this
 * account as an administrator (demoted, suspended, role out of date); a 401
 * means there is no session any more (expired, revoked — even by this very admin). */
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const result = await apiFetch<T>(path, init);
    // anything but a read may have changed what a remembered list shows
    if (init?.method && init.method !== 'GET') invalidateAdminLists();
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && err.code === ERROR_CODES.forbidden) reportAdminAccessLost();
    else if (err instanceof ApiError && err.status === 401) reportAdminSessionEnded();
    throw err;
  }
}

function qs(params: Record<string, string | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === true) q.set(key, '1');
    else if (typeof value === 'string' && value) q.set(key, value);
  }
  const text = q.toString();
  return text ? `?${text}` : '';
}

const post = <T = { ok: true }>(path: string, body: Record<string, unknown>) => adminFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

// ---- users -------------------------------------------------------------------

export interface AdminUserRow {
  id: string; username: string; displayName: string; avatar: string; avatarColor: string;
  role: 'user' | 'admin'; status: 'active' | 'suspended'; createdAt: string;
  lastSeenAt: string | null; online: boolean;
}
export interface AuditRow {
  id: string; at: string; actorId: string | null; actorLabel: string; action: string; targetType: string;
  targetId: string; targetLabel: string; reason: string; result: 'ok' | 'failed'; detail: Record<string, unknown>; requestId: string;
}
export interface AdminUserDetail {
  user: AdminUserRow & { email: string | null; statusReason: string; statusChangedAt: string | null };
  servers: { id: string; name: string; status: string; isOwner: boolean }[];
  storage: { bytes: number; files: number };
  history: AuditRow[];
}

export const fetchAdminUsers = (filters: { q?: string; status?: string; role?: string; from?: string; to?: string }, cursor: string | null) =>
  adminFetch<Page<AdminUserRow>>(`/api/admin/users${qs({ ...filters, cursor })}`);
export const fetchAdminUser = (id: string) => adminFetch<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
export const suspendUser = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/suspend`, { reason });
export const reactivateUser = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/reactivate`, { reason });
export const grantAdmin = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/grant-admin`, { reason });
export const revokeAdmin = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/revoke-admin`, { reason });
export const revokeUserSessions = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { reason });
export const deleteUser = (id: string, reason: string, confirm: string) =>
  adminFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason, confirm }) });

// ---- servers -----------------------------------------------------------------

export interface AdminServerRow {
  id: string; name: string; icon: string; status: 'active' | 'suspended'; memberCount: number; channelCount: number;
  ownerId: string | null; ownerUsername: string | null; createdAt: string; lastMessageAt: number | null;
}
export interface AdminServerMember { user: { id: string; username: string; displayName: string; avatar: string; avatarColor: string }; roleIds: string[]; isOwner: boolean; at: string }
export interface AdminServerDetail {
  server: AdminServerRow & { statusReason: string };
  channels: { id: string; type: 'text' | 'voice'; name: string }[];
  members: Page<AdminServerMember>;
  history: AuditRow[];
}

export const fetchAdminServers = (filters: { q?: string; status?: string; orphan?: boolean }, cursor: string | null) =>
  adminFetch<Page<AdminServerRow>>(`/api/admin/servers${qs({ ...filters, cursor })}`);
export const fetchAdminServer = (id: string, cursor?: string | null) => adminFetch<AdminServerDetail>(`/api/admin/servers/${encodeURIComponent(id)}${qs({ cursor })}`);
export const suspendServer = (id: string, reason: string) => post(`/api/admin/servers/${encodeURIComponent(id)}/suspend`, { reason });
export const reactivateServer = (id: string, reason: string) => post(`/api/admin/servers/${encodeURIComponent(id)}/reactivate`, { reason });
export const assignServerOwner = (id: string, userId: string, reason: string) => post(`/api/admin/servers/${encodeURIComponent(id)}/owner`, { userId, reason });
export const deleteServer = (id: string, reason: string) =>
  adminFetch<{ ok: true }>(`/api/admin/servers/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });

// ---- webhooks ----------------------------------------------------------------

export interface AdminWebhookRow {
  id: string; name: string; avatar: string; channelId: string; channelName: string; serverId: string; serverName: string; serverStatus: string;
  createdAt: string; lastUsedAt: string | null; messageCount: number;
}
export interface AdminWebhookDetail {
  webhook: AdminWebhookRow & { tokenRotatedAt: string; messagesLast24h: number };
  history: AuditRow[];
}

export const fetchAdminWebhooks = (filters: { q?: string }, cursor: string | null) =>
  adminFetch<Page<AdminWebhookRow>>(`/api/admin/webhooks${qs({ ...filters, cursor })}`);
export const fetchAdminWebhook = (id: string) => adminFetch<AdminWebhookDetail>(`/api/admin/webhooks/${encodeURIComponent(id)}`);
export const revokeWebhook = (id: string, reason: string) => post(`/api/admin/webhooks/${encodeURIComponent(id)}/revoke`, { reason });

// ---- reports -----------------------------------------------------------------

export interface AdminReportRow {
  id: string; targetType: 'user' | 'server' | 'message'; targetId: string; targetLabel: string; category: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; reporter: string | null; assignee: string | null; createdAt: string;
}
export interface AdminReportDetail {
  report: AdminReportRow & { details: string; snapshot: Record<string, unknown>; resolution: string; resolutionNote: string; resolvedAt: string | null };
  history: AuditRow[];
}
export type ReportAction = 'suspend_user' | 'suspend_server' | 'delete_message';

export const fetchAdminReports = (filters: { status?: string; targetType?: string }, cursor: string | null) =>
  adminFetch<Page<AdminReportRow>>(`/api/admin/reports${qs({ ...filters, cursor })}`);
export const fetchAdminReport = (id: string) => adminFetch<AdminReportDetail>(`/api/admin/reports/${encodeURIComponent(id)}`);
export const claimReport = (id: string, reason: string) => post(`/api/admin/reports/${encodeURIComponent(id)}/claim`, { reason });
export const resolveReport = (id: string, input: { reason: string; action: ReportAction | null; dismiss: boolean }) =>
  post(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, input);

// ---- audit -------------------------------------------------------------------

export const fetchAudit = (filters: { actor?: string; targetType?: string; targetId?: string; action?: string; from?: string; to?: string }, cursor: string | null) =>
  adminFetch<Page<AuditRow>>(`/api/admin/audit${qs({ ...filters, cursor })}`);

// ---- system ------------------------------------------------------------------

export interface SweepResult {
  at: string; dryRun: boolean; scanned: number; orphanCount: number; orphanBytes: number; deleted: number; failed: number; recent: number; missingFiles: number;
}
export interface SystemInfo {
  storage: { usedBytes: number; files: number; maxBytes: number };
  connections: { live: number; onlineAccounts: number; max: number; perAccountMax: number };
  accounts: { total: number; newLastHour: number; newPerHourCap: number; activeAdmins: number; suspended: number };
  livekit: { configured: boolean };
  outbox: { pending: number; failed: number };
  notifications: { unread: number };
  orphanSweep: { dryRunByDefault: boolean; /** absent on a server that predates it */ graceMs?: number; last: SweepResult | null };
}

export const fetchSystem = () => adminFetch<SystemInfo>('/api/admin/system');
export const sweepOrphans = (input: { dryRun: true } | { dryRun: false; reason: string }) =>
  adminFetch<{ result: SweepResult }>('/api/admin/system/sweep-orphans', { method: 'POST', body: JSON.stringify(input) });
