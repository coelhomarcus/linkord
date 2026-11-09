import type { FastifyInstance } from 'fastify';

/** Public liveness probe (Docker, Dokploy, the e2e stack). It answers nothing but `ok`:
 * connection counts and uptime would tell anyone when the server was last deployed and
 * how busy it is; administrators get those from `/api/admin/system`. */
export function registerHealthRoute(fastify: FastifyInstance): void {
  fastify.get('/healthz', async () => ({ ok: true }));
}
