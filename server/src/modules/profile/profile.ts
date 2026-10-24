import type { FastifyInstance } from 'fastify';
import { config } from '../../config/env.js';
import { handleAvatarUpload } from './avatarUpload.js';

export function registerProfileRoutes(fastify: FastifyInstance): void {
  // raw Buffer body, not JSON — scoped plugin so a wildcard/JSON override
  // here doesn't affect any other /api/* route.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/avatar', { bodyLimit: config.MAX_AVATAR_BYTES }, handleAvatarUpload);
  });
}
