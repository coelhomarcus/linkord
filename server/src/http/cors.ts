import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { hostOf, isOriginAllowed } from './originGuard.js';

const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
// Authorization is how a native shell sends its session (see
// sessionTokenFromHeaders) — without it listed here, a browser's preflight
// blocks every authenticated cross-origin call before it's even sent.
const ALLOWED_HEADERS = 'Content-Type, Authorization';

/** /api/* and /uploads/* are the only paths a trusted app shell ever calls
 * cross-origin; everything else is either static web assets (irrelevant to
 * a native build, which ships its own) or the SPA fallback. */
export function isCorsEligible(url: string): boolean {
  return url.startsWith('/api/') || url.startsWith('/uploads/');
}

/** True for a request from one of our own trusted app shells (the Tauri
 * desktop app, the React Native app) — these run from their own origin
 * instead of the server's, so credentialed `fetch` calls need real CORS
 * response headers. An ordinary same-origin browser request never trips
 * this (no Origin header, or one matching the request's own host), so the
 * plain web deploy is unaffected. */
export function isTrustedCrossOrigin(origin: string | undefined, requestHost: string | undefined): boolean {
  if (!origin) return false;
  const host = hostOf(origin);
  if (!host || host === (requestHost || '').toLowerCase()) return false;
  return isOriginAllowed({ origin, requestHost, appUrl: config.APP_URL, allowedOrigins: config.ALLOWED_ORIGINS, isDev: config.IS_DEV });
}

/** Fastify `onRequest` hook: answers the preflight and tags the real
 * response with CORS headers for /api/* and /uploads/* calls from a
 * trusted app shell. Registered ahead of originGuard — OPTIONS is already
 * a "safe" method that guard skips, so there's no ordering conflict. */
export async function corsHeaders(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isCorsEligible(request.url)) return;
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  if (!isTrustedCrossOrigin(origin, request.headers.host)) return;

  reply.header('Access-Control-Allow-Origin', origin!);
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Vary', 'Origin');

  if (request.method === 'OPTIONS') {
    reply.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
    reply.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    reply.code(204).send();
  }
}
