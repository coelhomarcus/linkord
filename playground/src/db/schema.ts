import { customType, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Each playground's world (worlds.ts), saved as its players change it: the blocks, one byte a cell
 * (game/grid.ts), deflated, and their states the same way (null for a world saved before states, all
 * zeros); the furnaces with what is in them; the items lying on the ground; its clock in
 * ticks (game/dayTime.ts: the time of day and the moon's phase). `generator`
 * is the version of game/worldGen.ts that first made it. */
export const playgroundWorlds = pgTable('playground_worlds', {
  conversationId: text('conversation_id').primaryKey(),
  generator: integer('generator').notNull(),
  blocks: bytea('blocks').notNull(),
  states: bytea('states'),
  furnaces: jsonb('furnaces').notNull().default([]),
  items: jsonb('items').notNull().default([]),
  clock: integer('clock').notNull().default(1000),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What each account carries in each playground (inventories.ts): its 41 slots and the hotbar slot in hand. */
export const playgroundInventories = pgTable('playground_inventories', {
  conversationId: text('conversation_id').notNull(),
  userId: text('user_id').notNull(),
  inventory: jsonb('inventory').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]);
