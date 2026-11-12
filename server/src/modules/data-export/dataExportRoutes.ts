import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { parseCookies } from '../../http/cookies.js';
import { sendError, sendJson } from '../../http/respond.js';
import { recordAudit } from '../admin/auditLog.js';
import { resolveSession } from '../auth/session.js';
import { findDownload, getExportStatus, requestDataExport } from './dataExport.js';

// /api/account/data-export — asking for a copy of your data, its state, and downloading it.

const SETTINGS_SECTION = '/app/settings/privacy#data-export';

function sessionFor(request: FastifyRequest) {
  return resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
}

async function handleStatus(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionFor(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  sendJson(reply, 200, await getExportStatus(sess.userId));
}

async function handleRequest(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await sessionFor(request);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const result = await requestDataExport({ id: sess.userId, username: sess.username }, request.id);
  if (result.code === 'rate_limited') {
    reply.header('Retry-After', String(Math.max(1, Math.ceil((result.retryAt.getTime() - Date.now()) / 1000))));
    return sendJson(reply, 429, {
      error: { code: 'rate_limited', message: 'Você já pediu uma cópia dos seus dados hoje. Tente novamente mais tarde.', retryAt: result.retryAt.toISOString() },
    });
  }
  sendJson(reply, 202, { export: result.export });
}

async function handleDownload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<unknown> {
  const sess = await sessionFor(request);
  // the link in the email opens in a browser that may not be signed in: send it where it can sign in and
  // download from settings, rather than to a JSON error
  if (!sess) return reply.code(302).header('Cache-Control', 'no-store').header('Location', SETTINGS_SECTION).send();
  const found = await findDownload(sess.userId, String(request.params.id || ''));
  if (found.code === 'expired') return sendError(reply, 410, 'export_expired', 'Este link expirou. Peça uma nova cópia em Configurações → Dados e privacidade.');
  if (found.code !== 'ok') return sendError(reply, 404, 'not_found', 'Cópia não encontrada.');
  await recordAudit({
    actor: { id: sess.userId, username: sess.username }, action: 'account.data_export_download', targetType: 'user', targetId: sess.userId,
    targetLabel: sess.username, detail: { exportId: request.params.id }, requestId: request.id,
  });
  // see attachmentServing.ts: returning the reply keeps Fastify from racing in an empty response
  return reply
    .code(200)
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', `attachment; filename="${found.fileName.replace(/[^\w.-]/g, '_')}"`)
    .header('Content-Length', found.sizeBytes)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'no-store')
    .send(fs.createReadStream(found.file));
}

export function registerDataExportRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/account/data-export', handleStatus);
  fastify.post('/api/account/data-export', handleRequest);
  fastify.get<{ Params: { id: string } }>('/api/account/data-export/:id/download', handleDownload);
}
