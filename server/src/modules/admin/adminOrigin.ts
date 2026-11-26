import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendError } from '../../http/respond.js';

export function adminCookieName(): string {
  return config.ADMIN_ORIGIN?.secure ? '__Host-overcord-admin' : 'overcord_admin';
}

export function requireAdminOrigin(request: FastifyRequest, reply: FastifyReply): boolean {
  const admin = config.ADMIN_ORIGIN;
  if (!admin || request.headers.host?.toLowerCase() !== admin.host) {
    sendError(reply, 404, 'not_found', 'Não encontrado.');
    return false;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.origin !== admin.url) {
    sendError(reply, 403, 'forbidden_origin', 'Origem não permitida.');
    return false;
  }
  return true;
}
