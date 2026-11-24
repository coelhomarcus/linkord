import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { and, eq, inArray } from 'drizzle-orm';
import type { PlaygroundDb } from './db/client.js';
import { playgroundInventories, playgroundWorlds } from './db/schema.js';

// Where worlds and inventories are kept between visits and restarts. A world is
// saved whole (its blocks deflated: mostly whole layers of stone, then of air,
// it shrinks to a small part of its megabyte), an inventory as JSON.

export interface StoredWorld {
  generator: number;
  /** one byte a cell, as game/grid.ts lays them out */
  blocks: Uint8Array;
  furnaces: unknown;
  items: unknown;
}

export interface WorldStore {
  load(conversationId: string): Promise<StoredWorld | null>;
  save(conversationId: string, world: StoredWorld): Promise<void>;
}

export interface InventoryStore {
  load(conversationId: string, userId: string): Promise<unknown>;
  save(conversationId: string, userId: string, inventory: unknown): Promise<void>;
  /** drops what these accounts carried anywhere (they were deleted in the app) */
  forget(userIds: string[]): Promise<void>;
}

export function databaseWorldStore(db: PlaygroundDb): WorldStore {
  return {
    async load(conversationId) {
      const [row] = await db.select().from(playgroundWorlds).where(eq(playgroundWorlds.conversationId, conversationId)).limit(1);
      if (!row) return null;
      return { generator: row.generator, blocks: new Uint8Array(inflateRawSync(row.blocks)), furnaces: row.furnaces, items: row.items };
    },
    async save(conversationId, world) {
      const values = { generator: world.generator, blocks: deflateRawSync(world.blocks), furnaces: world.furnaces, items: world.items, updatedAt: new Date() };
      await db.insert(playgroundWorlds).values({ conversationId, ...values })
        .onConflictDoUpdate({ target: playgroundWorlds.conversationId, set: values });
    },
  };
}

export function databaseInventoryStore(db: PlaygroundDb): InventoryStore {
  const where = (conversationId: string, userId: string) => and(eq(playgroundInventories.conversationId, conversationId), eq(playgroundInventories.userId, userId));
  return {
    async load(conversationId, userId) {
      const [row] = await db.select({ inventory: playgroundInventories.inventory }).from(playgroundInventories)
        .where(where(conversationId, userId)).limit(1);
      return row?.inventory ?? null;
    },
    async save(conversationId, userId, inventory) {
      await db.insert(playgroundInventories).values({ conversationId, userId, inventory, updatedAt: new Date() })
        .onConflictDoUpdate({ target: [playgroundInventories.conversationId, playgroundInventories.userId], set: { inventory, updatedAt: new Date() } });
    },
    async forget(userIds) {
      if (userIds.length > 0) await db.delete(playgroundInventories).where(inArray(playgroundInventories.userId, userIds));
    },
  };
}

/** Kept in memory: what tests use. */
export function memoryWorldStore(): WorldStore & { rows: Map<string, StoredWorld> } {
  const rows = new Map<string, StoredWorld>();
  return {
    rows,
    async load(conversationId) {
      const row = rows.get(conversationId);
      return row ? { ...row, blocks: new Uint8Array(row.blocks) } : null;
    },
    async save(conversationId, world) { rows.set(conversationId, { ...world, blocks: new Uint8Array(world.blocks) }); },
  };
}

export function memoryInventoryStore(): InventoryStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>();
  return {
    rows,
    async load(conversationId, userId) { return structuredClone(rows.get(`${conversationId}:${userId}`) ?? null); },
    async save(conversationId, userId, inventory) { rows.set(`${conversationId}:${userId}`, structuredClone(inventory)); },
    async forget(userIds) { for (const key of [...rows.keys()]) if (userIds.some((userId) => key.endsWith(`:${userId}`))) rows.delete(key); },
  };
}
