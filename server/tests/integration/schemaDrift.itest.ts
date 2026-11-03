import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { Pool } from 'pg';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../../src/db/schema.js';
import { createIsolatedDatabase } from '../../src/scripts/rehearsal/isolatedDb.js';
import { pool } from './helpers.js';

// The migrations are partly written by hand (data moves, renames drizzle-kit
// can't infer), so nothing but this keeps them honest: the database they build
// must be the one schema.ts describes — same columns, constraints and indexes.

after(() => pool.end());

async function catalog(db: Pool) {
  const cols = (await db.query(`select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default, is_generated
    from information_schema.columns where table_schema = 'public' order by 1, 2`)).rows;
  const cons = (await db.query(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as d
    from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`)).rows;
  const idx = (await db.query(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2`)).rows;
  return JSON.stringify({ cols, cons, idx });
}

describe('schema drift (real Postgres)', () => {
  it('the migrated database is exactly what schema.ts declares', async () => {
    const baseUrl = process.env.TEST_DATABASE_BASE_URL ?? process.env.DATABASE_URL!;
    const fromSchema = await createIsolatedDatabase(baseUrl, 'test', `drift_${Date.now().toString(36)}`);
    try {
      for (const statement of await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema as Record<string, unknown>))) {
        await fromSchema.pool.query(statement);
      }
      assert.equal(await catalog(pool), await catalog(fromSchema.pool));
    } finally {
      await fromSchema.drop();
    }
  });
});
