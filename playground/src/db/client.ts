import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PlaygroundConfig } from '../config.js';
import * as schema from './schema.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'db' });

export type PlaygroundDb = NodePgDatabase<typeof schema>;

/** The service's one pool. Small: a few players write a little now and then. */
export function openDatabase(config: Pick<PlaygroundConfig, 'databaseUrl' | 'databaseSsl'>): { pool: Pool; db: PlaygroundDb } {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: config.databaseSsl ? { rejectUnauthorized: true } : undefined,
  });
  // an error on an idle connection (the database restarted) must not become an uncaught exception
  pool.on('error', (err) => log.error('error on an idle pool connection', err));
  return { pool, db: drizzle(pool, { schema }) };
}
