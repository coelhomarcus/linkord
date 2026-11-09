import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../../lib/logger.js';
import * as floodControl from '../../realtime/floodControl.js';
import { CSP_REPORT_PATH } from '../../http/securityHeaders.js';

// Content-Security-Policy violations the browser reports, written into the
// server's log so a policy that blocks something real shows up. Anyone can
// post here (browsers send reports without credentials), so everything is
// cut short and URLs lose their query and fragment, which may carry tokens.

const log = logger.child({ component: 'csp' });

const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD = 300;
// a batch from the Reporting API carries the whole policy once per report
const BODY_LIMIT = 64 * 1024;

export interface CspViolation {
  directive: string;
  blocked?: string;
  document?: string;
  source?: string;
  line?: number;
  disposition?: string;
  sample?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? (value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value) : undefined;

/** Keeps a URL's origin and path; keywords like 'inline' or 'eval' pass as they are. */
function withoutQuery(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return `${url.protocol}…`;
    return text(`${url.origin === 'null' ? url.protocol : url.origin}${url.pathname}`);
  } catch {
    return raw.split(/[?#]/)[0];
  }
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function violationFrom(fields: {
  directive: unknown; blocked: unknown; document: unknown; source: unknown; line: unknown; disposition: unknown; sample: unknown;
}): CspViolation | null {
  const directive = text(fields.directive);
  if (!directive) return null;
  return {
    directive,
    blocked: withoutQuery(fields.blocked),
    document: withoutQuery(fields.document),
    source: withoutQuery(fields.source),
    line: typeof fields.line === 'number' && Number.isFinite(fields.line) ? fields.line : undefined,
    disposition: text(fields.disposition),
    sample: text(fields.sample),
  };
}

/** Reads either format: `{ "csp-report": {...} }` from report-uri, or the
 * Reporting API's array of `{ type: "csp-violation", body: {...} }`. */
export function parseCspReports(payload: unknown): CspViolation[] {
  const legacy = recordOf(recordOf(payload)?.['csp-report']);
  if (legacy) {
    const violation = violationFrom({
      directive: legacy['effective-directive'] ?? legacy['violated-directive'],
      blocked: legacy['blocked-uri'], document: legacy['document-uri'], source: legacy['source-file'],
      line: legacy['line-number'], disposition: legacy.disposition, sample: legacy['script-sample'],
    });
    return violation ? [violation] : [];
  }
  if (!Array.isArray(payload)) return [];
  const violations: CspViolation[] = [];
  for (const entry of payload.slice(0, MAX_REPORTS_PER_REQUEST)) {
    const report = recordOf(entry);
    const body = recordOf(report?.body);
    if (report?.type !== 'csp-violation' || !body) continue;
    const violation = violationFrom({
      directive: body.effectiveDirective, blocked: body.blockedURL, document: body.documentURL ?? report.url,
      source: body.sourceFile, line: body.lineNumber, disposition: body.disposition, sample: body.sample,
    });
    if (violation) violations.push(violation);
  }
  return violations;
}

async function handleCspReport(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // a page stuck in a loop of violations must not flood the log
  if (floodControl.allow(`csp-report:${request.ip}`, { windowMs: 60_000, max: 30 })) {
    for (const violation of parseCspReports(request.body)) log.warn('content security policy violation', { ...violation, reqId: request.id });
  }
  reply.code(204).send();
}

export function registerCspReportRoutes(fastify: FastifyInstance): void {
  // scoped: these content types are only accepted on this route
  fastify.register(async (scope) => {
    scope.addContentTypeParser(['application/csp-report', 'application/reports+json'], { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_request, body, done) => {
      try { done(null, JSON.parse(body as string)); } catch { done(null, null); }
    });
    scope.post(CSP_REPORT_PATH, { bodyLimit: BODY_LIMIT }, handleCspReport);
  });
}
