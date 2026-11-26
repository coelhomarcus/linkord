import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { isSecureRequest } from './cookies.js';
import { buildContentSecurityPolicy, readBuildScriptHashes, readBuildStyleHashes, reportingEndpoints } from './pageSecurityPolicy.js';

const API_POLICY = "default-src 'none'; frame-ancestors 'none'";

interface PagePolicy { policy: string; reports: string | undefined }

/** Fastify `onRequest` hook that sends the security headers on every response,
 * errors and 404s included. Pages on the admin host (`ADMIN_URL`) get a policy
 * built from the admin build, for that origin, with no LiveKit or KLIPY. */
export function securityHeaders(publicDir: string, admin: { dir: string; url: string; host: string } | null = null) {
  const header = config.CSP_REPORT_ONLY ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  const app: PagePolicy = {
    policy: buildContentSecurityPolicy({
      appUrl: config.APP_URL,
      livekitUrl: config.LIVEKIT_URL,
      klipyEnabled: !!config.KLIPY_API_KEY,
      mediaProxyEnabled: config.MEDIA_PROXY_ENABLED,
      scriptHashes: readBuildScriptHashes(publicDir),
      styleHashes: readBuildStyleHashes(publicDir),
    }),
    reports: reportingEndpoints(config.APP_URL),
  };
  const adminPage: PagePolicy | null = admin && {
    policy: buildContentSecurityPolicy({
      appUrl: admin.url,
      livekitUrl: '',
      klipyEnabled: false,
      mediaProxyEnabled: config.MEDIA_PROXY_ENABLED,
      scriptHashes: readBuildScriptHashes(admin.dir),
      styleHashes: readBuildStyleHashes(admin.dir),
    }),
    reports: reportingEndpoints(admin.url),
  };
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (/^\/api(?:[/?]|$)/.test(request.url)) reply.header('Content-Security-Policy', API_POLICY);
    else {
      const page = adminPage && request.headers.host?.toLowerCase() === admin!.host ? adminPage : app;
      reply.header(header, page.policy);
      if (page.reports) reply.header('Reporting-Endpoints', page.reports);
    }
    // frame-ancestors for browsers too old to read it from the policy
    reply.header('X-Frame-Options', 'DENY');
    // no includeSubDomains: other services may live under the same domain over plain http
    if (isSecureRequest(request.raw)) reply.header('Strict-Transport-Security', 'max-age=31536000');
  };
}
