import type { FastifyInstance } from 'fastify';
import { config } from '../../config/env.js';
import { sendError, sendJson } from '../../http/respond.js';
import { createDesktopDownloads } from './desktopDownloads.js';

const latest = createDesktopDownloads({ repo: config.DESKTOP_RELEASES_REPO });

export function registerDesktopRoutes(fastify: FastifyInstance): void {
  // public: the login screen offers the installer too, and the shared, cached lookup keeps
  // anonymous requests from reaching GitHub more than once per cache window
  fastify.get('/api/desktop/downloads', async (_request, reply) => {
    const downloads = await latest();
    if (!downloads) return sendError(reply, 404, 'not_found', 'Nenhuma versão do app para computador publicada.');
    sendJson(reply, 200, downloads);
  });
}
