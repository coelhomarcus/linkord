import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { missingConfig, readConfig } from '../config.js';
import { openDatabase, type PlaygroundDb } from './client.js';

// playground/db/migrations sits outside src/ (drizzle-kit writes it); compiled, this
// file is playground/dist/db/migrate.js, two levels below playground/.
const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');

/** Applies pending migrations, at every boot (index.ts) and from `npm run db:playground:migrate`. */
export async function runMigrations(db: PlaygroundDb): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

if (process.argv[1] === import.meta.filename) {
  const missing = missingConfig(process.env);
  if (missing) {
    console.error(`Cannot migrate the playground database: ${missing}.`);
    process.exit(1);
  }
  const { pool, db } = openDatabase(readConfig(process.env));
  runMigrations(db)
    .then(() => { console.log('Playground migrations applied.'); return pool.end(); })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Failed to apply playground migrations:', err instanceof Error ? err.stack : err);
      process.exit(1);
    });
}
