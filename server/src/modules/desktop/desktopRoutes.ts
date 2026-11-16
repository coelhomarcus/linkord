import type { FastifyInstance } from 'fastify';
import { config } from '../../config/env.js';
import { sendError, sendJson } from '../../http/respond.js';
import { requireSession } from '../servers/serverHttp.js';
import { createDesktopDownloads } from './desktopDownloads.js';

const latest = createDesktopDownloads({ repo: config.DESKTOP_RELEASES_REPO });

export function registerDesktopRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/desktop/downloads', async (request, reply) => {
    if (!(await requireSession(request, reply))) return;
    const downloads = await latest();
    if (!downloads) return sendError(reply, 404, 'not_found', 'Nenhuma versão do app para computador publicada.');
    sendJson(reply, 200, downloads);
  });
}
