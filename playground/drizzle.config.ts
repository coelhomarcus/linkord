import type { Config } from 'drizzle-kit';

// The playground service's database, apart from the app's (../drizzle.config.ts).
export default {
  dialect: 'postgresql',
  schema: './playground/src/db/schema.ts',
  out: './playground/db/migrations',
  dbCredentials: { url: process.env.PLAYGROUND_DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
} satisfies Config;
