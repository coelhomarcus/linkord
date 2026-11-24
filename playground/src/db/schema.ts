import { integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

// The playground's own database (PLAYGROUND_DATABASE_URL), apart from the app's.
// Ids here are the app's (accounts, conversations) as plain text: there is no
// foreign key across two databases, so a row may outlive what it names.

/** Experience earned from kills, per account and playground (combat.ts). */
export const playgroundExperience = pgTable('playground_experience', {
  conversationId: text('conversation_id').notNull(),
  userId: text('user_id').notNull(),
  points: integer('points').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]);

/** The skin each account wears in playgrounds (skins.ts): a 64×64 or 64×32 PNG, base64, at most 14 kB.
 * No row means the default skin, drawn by the client from the account's id. */
export const playgroundSkins = pgTable('playground_skins', {
  userId: text('user_id').primaryKey(),
  png: text('png').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
