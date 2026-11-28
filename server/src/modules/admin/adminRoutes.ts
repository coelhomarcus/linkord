import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import type { ErrorCode } from '../../http/errors.js';
import * as floodControl from '../../realtime/floodControl.js';
import { requireAdmin, requireAdminSession } from './adminAuth.js';
import { confirmPassword, sendCurrentEmailCode, verifyCurrentEmailCode } from '../auth/accountConfirmation.js';
import { findById } from '../users/users.js';
import { normalizeReason } from './adminPolicy.js';
import { listAudit } from './auditLog.js';
import {
  deleteUserAccount, getAdminUser, listAdminUsers, reactivateUser, revokeUserSessions, setAdminRole, setUserBadge, suspendUser,
  type AdminRoleResult, type BadgeActionResult, type UserActionResult,
} from './adminUsers.js';
import {
  assignServerOwner, deleteServerAsAdmin, getAdminServer, listAdminServers, reactivateServer, suspendServer,
  type ServerActionResult,
} from './adminServers.js';
import { getAdminWebhook, listAdminWebhooks, revokeWebhook, type WebhookActionResult } from './adminWebhooks.js';
import { claimReport, getAdminReport, listAdminReports, resolveReport, type ReportActionResult } from './adminReports.js';
import { getSystemInfo } from './adminSystem.js';
import { getAdminCallMetrics } from './adminCallMetrics.js';
import { SweepInProgressError, sweepOrphans } from '../attachments/orphanSweeper.js';
import { getBackupInfo, handleBackupDownload, issueDownloadToken, pgDumpAvailable } from '../backups/backupDownload.js';
import type { ReportAction } from '../reports/reportsPolicy.js';
import { isBadgeId } from '../badges/badgeCatalog.js';

type Query = Record<string, string | undefined>;
type IdParams = { id: string };
type BadgeParams = { id: string; badge: string };

const ERRORS: Record<string, [number, ErrorCode, string]> = {
  not_found: [404, 'not_found', 'Não encontrado.'],
  forbidden: [403, 'forbidden', 'Você não tem mais permissão de administrador.'],
  self: [409, 'self_action', 'Você não pode fazer isso na própria conta.'],
  last_admin: [409, 'last_admin', 'Essa conta é o último administrador ativo.'],
  already_suspended: [409, 'already_suspended', 'Já está suspenso.'],
  not_suspended: [409, 'not_suspended', 'Não está suspenso.'],
  not_member: [409, 'not_member', 'Essa conta não é membro do servidor.'],
  confirmation_mismatch: [400, 'confirmation_mismatch', 'A confirmação não confere.'],
  already_admin: [409, 'already_admin', 'Essa conta já é administradora.'],
  not_admin: [409, 'not_admin', 'Essa conta não é administradora.'],
  already_held: [409, 'already_held', 'Essa conta já tem essa insígnia.'],
  not_held: [409, 'not_held', 'Essa conta não tem essa insígnia.'],
  target_inactive: [409, 'target_inactive', 'Só uma conta ativa pode virar administradora.'],
  already_closed: [409, 'already_closed', 'Essa denúncia já foi encerrada.'],
  not_open: [409, 'not_open', 'Essa denúncia já está em análise.'],
  invalid_action: [400, 'invalid_action', 'Essa ação não se aplica a esse tipo de denúncia.'],
  action_failed: [409, 'action_failed', 'Não foi possível aplicar a ação; a denúncia continua aberta.'],
  busy: [409, 'conflict', 'Outra decisão sobre esta denúncia está em andamento. Atualize e confira o resultado.'],
};

async function runSweep(reply: FastifyReply, opts: Parameters<typeof sweepOrphans>[0]): Promise<void> {
  try {
    sendJson(reply, 200, { result: await sweepOrphans(opts) });
  } catch (err) {
    if (!(err instanceof SweepInProgressError)) throw err;
    sendError(reply, 409, 'conflict', err.message);
  }
}

function respond(reply: FastifyReply, result: UserActionResult | ServerActionResult | WebhookActionResult | ReportActionResult | AdminRoleResult | BadgeActionResult): void {
  if (result.code === 'ok') return sendJson(reply, 200, { ok: true });
  const [status, code, message] = ERRORS[result.code] ?? [500, 'internal_error', 'Erro interno.'];
  sendError(reply, status, code, message);
}

/** Auth + the shared preamble of every mutating action: an active admin RIGHT
 * NOW, inside the destructive-action rate limit, with a written reason. */
async function mutating(request: FastifyRequest, reply: FastifyReply) {
  const session = await requireAdminSession(request, reply);
  if (!session) return null;
  const actor = { id: session.userId, username: session.username };
  if (!floodControl.allow(`admin-action:${actor.id}`, { windowMs: 60_000, max: 30 })) {
    sendError(reply, 429, 'rate_limited', 'Muitas ações seguidas. Espere um pouco.');
    return null;
  }
  const body = request.body == null ? {} : jsonBody(request.body);
  const reason = normalizeReason(body.reason);
  if (!reason) {
    sendError(reply, 400, 'reason_required', 'Informe o motivo (3 a 500 caracteres).');
    return null;
  }
  return { actor, reason, body, session };
}

async function reading<T>(request: FastifyRequest, reply: FastifyReply, run: () => Promise<T | 'invalid_cursor' | null>): Promise<void> {
  if (!(await requireAdmin(request, reply))) return;
  const result = await run();
  if (result === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  if (result === null) return sendError(reply, 404, 'not_found', 'Não encontrado.');
  sendJson(reply, 200, result);
}

export function registerAdminRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/admin/users', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { q, status, role, from, to, cursor } = request.query;
    return listAdminUsers({ q, status, role, from, to }, cursor);
  }));
  fastify.get('/api/admin/users/:id', (request: FastifyRequest<{ Params: IdParams }>, reply) => reading(request, reply, () => getAdminUser(request.params.id)));

  fastify.post('/api/admin/users/:id/suspend', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await suspendUser({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/users/:id/reactivate', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await reactivateUser({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/users/:id/revoke-sessions', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await revokeUserSessions({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  for (const action of ['grant', 'revoke'] as const) {
    const path = `/api/admin/users/:id/${action}-admin`;
    const codeScope = (tokenHash: string, id: string, reason: string) =>
      crypto.createHash('sha256').update(JSON.stringify([tokenHash, action, id, reason])).digest('hex');

    fastify.post(`${path}/request`, async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const m = await mutating(request, reply);
      if (!m || !await confirmPassword(reply, m.session, String(m.body.password ?? ''))) return;
      const user = await findById(m.actor.id);
      if (user?.role !== 'admin' || user.status !== 'active' || !user.twoFactorEmail) {
        return sendError(reply, 403, 'forbidden', 'Você não tem mais permissão de administrador.');
      }
      return sendCurrentEmailCode(reply, user, 'admin_role_change', codeScope(m.session.tokenHash, request.params.id, m.reason));
    });
    fastify.post(path, async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const m = await mutating(request, reply);
      if (!m || !await verifyCurrentEmailCode(request, reply, m.session, 'admin_role_change', codeScope(m.session.tokenHash, request.params.id, m.reason))) return;
      respond(reply, await setAdminRole({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, action));
    });
  }
  for (const [method, action] of [['post', 'grant'], ['delete', 'revoke']] as const) {
    fastify[method]('/api/admin/users/:id/badges/:badge', async (request: FastifyRequest<{ Params: BadgeParams }>, reply) => {
      const { badge } = request.params;
      if (!isBadgeId(badge)) return sendError(reply, 404, 'not_found', 'Insígnia desconhecida.');
      const m = await mutating(request, reply);
      if (m) respond(reply, await setUserBadge({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, badge, action));
    });
  }
  fastify.delete('/api/admin/users/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await deleteUserAccount({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, String(m.body.confirm ?? '')));
  });

  fastify.get('/api/admin/servers', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { q, status, orphan, cursor } = request.query;
    return listAdminServers({ q, status, orphan: orphan === '1' }, cursor);
  }));
  fastify.get('/api/admin/servers/:id', (request: FastifyRequest<{ Params: IdParams; Querystring: Query }>, reply) => reading(request, reply, () => getAdminServer(request.params.id, request.query.cursor)));
  fastify.post('/api/admin/servers/:id/suspend', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await suspendServer({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/servers/:id/reactivate', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await reactivateServer({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/servers/:id/owner', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (!m) return;
    const userId = String(m.body.userId ?? '');
    if (!userId) return sendError(reply, 400, 'invalid_request', 'Informe o novo dono.');
    respond(reply, await assignServerOwner({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, userId));
  });
  fastify.delete('/api/admin/servers/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await deleteServerAsAdmin({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });

  fastify.get('/api/admin/webhooks', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { q, cursor } = request.query;
    return listAdminWebhooks({ q }, cursor);
  }));
  fastify.get('/api/admin/webhooks/:id', (request: FastifyRequest<{ Params: IdParams }>, reply) => reading(request, reply, () => getAdminWebhook(request.params.id)));
  fastify.post('/api/admin/webhooks/:id/revoke', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await revokeWebhook({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });

  fastify.get('/api/admin/reports', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { status, targetType, cursor } = request.query;
    return listAdminReports({ status, targetType }, cursor);
  }));
  fastify.get('/api/admin/reports/:id', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const actor = await requireAdmin(request, reply);
    if (!actor) return;
    const detail = await getAdminReport({ actor, requestId: request.id }, request.params.id);
    if (!detail) return sendError(reply, 404, 'not_found', 'Não encontrado.');
    sendJson(reply, 200, detail);
  });
  fastify.post('/api/admin/reports/:id/claim', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (m) respond(reply, await claimReport({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id));
  });
  fastify.post('/api/admin/reports/:id/resolve', async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
    const m = await mutating(request, reply);
    if (!m) return;
    const action = m.body.action == null || m.body.action === '' ? null : String(m.body.action) as ReportAction;
    if (action !== null && !['suspend_user', 'suspend_server', 'delete_message'].includes(action)) {
      return sendError(reply, 400, 'invalid_action', 'Ação inválida.');
    }
    respond(reply, await resolveReport({ actor: m.actor, reason: m.reason, requestId: request.id }, request.params.id, { dismiss: m.body.dismiss === true, action }));
  });

  fastify.get('/api/admin/system', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    sendJson(reply, 200, await getSystemInfo());
  });

  fastify.get('/api/admin/call-metrics', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    sendJson(reply, 200, await getAdminCallMetrics());
  });
  // A dry run only reports and needs no justification; deleting files does.
  fastify.post('/api/admin/system/sweep-orphans', async (request, reply) => {
    const body = request.body == null ? {} : jsonBody(request.body);
    if (body.dryRun !== false) {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      return runSweep(reply, { dryRun: true, actor, requestId: request.id });
    }
    const m = await mutating(request, reply);
    if (!m) return;
    await runSweep(reply, { dryRun: false, actor: m.actor, requestId: request.id, reason: m.reason });
  });

  // A full backup: the page's numbers, a one-time link (needs a reason) and the ZIP it streams. See backupDownload.ts.
  fastify.get('/api/admin/backup', (request, reply) => reading(request, reply, () => getBackupInfo()));
  fastify.post('/api/admin/backup/download', async (request, reply) => {
    const m = await mutating(request, reply);
    if (!m) return;
    if (!(await pgDumpAvailable())) return sendError(reply, 503, 'backup_unavailable', 'O servidor não tem o pg_dump instalado; não é possível gerar o backup.');
    const issued = issueDownloadToken(m.actor, m.reason);
    if (issued.code === 'busy') return sendError(reply, 409, 'backup_running', 'Outro backup está sendo baixado. Espere ele terminar.');
    sendJson(reply, 200, { url: `/api/admin/backup/download/${issued.token}`, expiresAt: issued.expiresAt.toISOString() });
  });
  // the ZIP is not compressible (its entries are stored as they are) and its size is unknown until the end
  fastify.get<{ Params: { token: string } }>('/api/admin/backup/download/:token', { compress: false }, handleBackupDownload);

  fastify.get('/api/admin/audit', (request: FastifyRequest<{ Querystring: Query }>, reply) => reading(request, reply, () => {
    const { actor, targetType, targetId, action, from, to, cursor } = request.query;
    return listAudit({ actor, targetType, targetId, action, from, to }, cursor);
  }));
}
