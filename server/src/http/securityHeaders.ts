import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { isSecureRequest } from './cookies.js';
import { buildContentSecurityPolicy, readBuildScriptHashes, readBuildStyleHashes, reportingEndpoints } from './pageSecurityPolicy.js';

const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

/** Fastify `onRequest` hook that sends the security headers on every response,
 * errors and 404s included. */
export function securityHeaders(publicDir: string | null) {
  const header = config.CSP_REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const appPolicy = publicDir === null ? null : buildContentSecurityPolicy({
    appUrl: config.APP_URL,
    livekitUrl: config.LIVEKIT_URL,
    klipyEnabled: !!config.KLIPY_API_KEY,
    mediaProxyEnabled: config.MEDIA_PROXY_ENABLED,
    scriptHashes: readBuildScriptHashes(publicDir),
    styleHashes: readBuildStyleHashes(publicDir),
  });
  const reports = reportingEndpoints(config.APP_URL);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    // Responses from the backend-only image never render the app.
    if (appPolicy === null || /^\/api(?:[/?]|$)/.test(request.url)) reply.header('Content-Security-Policy', API_POLICY);
    else {
      reply.header(header, appPolicy);
      if (reports) reply.header('Reporting-Endpoints', reports);
    }
    // frame-ancestors for browsers too old to read it from the policy
    reply.header('X-Frame-Options', 'DENY');
    // no includeSubDomains: other services may live under the same domain over plain http
    if (isSecureRequest(request.raw)) reply.header('Strict-Transport-Security', 'max-age=31536000');
  };
}
