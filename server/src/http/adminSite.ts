import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendError } from './respond.js';

// The admin host reaches only these routes of the backend. Everything else on that host is the
// admin build or a 404, so the public app's API, socket and service worker never answer there.
const BACKEND_PATHS = /^\/(?:api\/admin(?:[/?]|$)|api\/csp-reports(?:\?|$)|uploads\/|(?:healthz|readyz)(?:\?|$))/;

function listFiles(dir: string, prefix = ''): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }); } catch { return []; }
  return entries.flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(dir, rel) : entry.isFile() ? [rel] : [];
  });
}

function cacheControl(file: string): string {
  if (file.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600';
}

function pathnameOf(url: string): string | null {
  try { return decodeURIComponent(url.split('?', 1)[0]!); } catch { return null; }
}

/** Fastify `onRequest` hook that serves the administration site's build on its own host
 * (`ADMIN_URL`) from the same process as the public app. The build is fixed for the life of
 * the process, so its file list is read once; a missing build serves only 404s. */
export function adminSite(dir: string, host: string) {
  const files = new Set(listFiles(dir));
  return async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> => {
    if (request.headers.host?.toLowerCase() !== host || BACKEND_PATHS.test(request.url)) return;
    const pathname = pathnameOf(request.url);
    if ((request.method === 'GET' || request.method === 'HEAD') && pathname !== null) {
      const requested = pathname.replace(/^\/+/, '') || 'index.html';
      // A deep link into the admin SPA. A missing file with an extension and the other backend
      // paths stay 404s, so an API or socket error never turns into a successful HTML page.
      const spa = !path.posix.extname(pathname) && !/^\/(?:api|ws|uploads)(?:\/|$)/.test(pathname);
      const file = files.has(requested) ? requested : spa ? 'index.html' : null;
      if (file && files.has(file)) {
        reply.header('Cache-Control', cacheControl(file));
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
        return reply.sendFile(file, dir, { cacheControl: false });
      }
    }
    sendError(reply, 404, 'not_found', 'Não encontrado.');
    return reply;
  };
}
