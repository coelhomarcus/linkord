import { eq, inArray, lt, sql } from 'drizzle-orm';
import type { PlaygroundDb } from './db/client.js';
import { playgroundSkins } from './db/schema.js';
import { parseSkinPng } from './skinPng.js';
import { playersIn, type Player } from './roster.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'skins' });

// The skin each account wears, kept here so it follows the account across
// reloads and devices. A player reads the skin of anyone in its own call when
// they show up (`skin-get`) and saves its own (`skin-set`); the LiveKit packet
// that announces a change (web playgroundSession.ts) is only the fast path.
// Skins saved before this service existed are handed over by the app
// (internal.ts, `importSkins`).

export interface SkinRow { userId: string; png: string; updatedAt: Date }

export interface SkinStore {
  get(userId: string): Promise<string | null>;
  set(userId: string, png: string): Promise<void>;
  remove(userId: string): Promise<void>;
  /** Keeps each row unless a newer one is already here (saved through this service since). */
  importNewer(rows: SkinRow[]): Promise<void>;
  forget(userIds: string[]): Promise<void>;
}

export function databaseSkinStore(db: PlaygroundDb): SkinStore {
  return {
    async get(userId) {
      const [row] = await db.select({ png: playgroundSkins.png }).from(playgroundSkins).where(eq(playgroundSkins.userId, userId)).limit(1);
      return row?.png ?? null;
    },
    async set(userId, png) {
      await db.insert(playgroundSkins).values({ userId, png })
        .onConflictDoUpdate({ target: playgroundSkins.userId, set: { png, updatedAt: new Date() } });
    },
    async remove(userId) {
      await db.delete(playgroundSkins).where(eq(playgroundSkins.userId, userId));
    },
    async importNewer(rows) {
      if (rows.length === 0) return;
      await db.insert(playgroundSkins).values(rows)
        .onConflictDoUpdate({
          target: playgroundSkins.userId,
          set: { png: sql`excluded.png`, updatedAt: sql`excluded.updated_at` },
          setWhere: lt(playgroundSkins.updatedAt, sql`excluded.updated_at`),
        });
    },
    async forget(userIds) {
      if (userIds.length > 0) await db.delete(playgroundSkins).where(inArray(playgroundSkins.userId, userIds));
    },
  };
}

/** Kept in memory: what tests use. */
export function memorySkinStore(): SkinStore & { rows: Map<string, { png: string; updatedAt: Date }> } {
  const rows = new Map<string, { png: string; updatedAt: Date }>();
  return {
    rows,
    async get(userId) { return rows.get(userId)?.png ?? null; },
    async set(userId, png) { rows.set(userId, { png, updatedAt: new Date() }); },
    async remove(userId) { rows.delete(userId); },
    async importNewer(imported) {
      for (const row of imported) {
        const current = rows.get(row.userId);
        if (!current || current.updatedAt < row.updatedAt) rows.set(row.userId, { png: row.png, updatedAt: row.updatedAt });
      }
    },
    async forget(userIds) { for (const id of userIds) rows.delete(id); },
  };
}

let store: SkinStore = memorySkinStore();

/** index.ts hands in the database; tests a memory store of their own. */
export function setSkinStore(next: SkinStore): void {
  store = next;
}

export function skinStore(): SkinStore {
  return store;
}

type Ack = (answer: Record<string, unknown>) => void;

/** Whether `player` may see `userId`'s skin: its own, or that of someone in its call right now. */
function canSee(player: Player, userId: string): boolean {
  if (userId === player.userId) return true;
  for (const other of playersIn(player.conversationId)) if (other.userId === userId) return true;
  return false;
}

/** `skin-get {userId}` → `{ skin }` (a base64 PNG, or null for the default), or `{ error }`: `not-here`
 * for someone not (yet) in the call, which the client asks again a little later. */
export async function handleSkinGet(player: Player, msg: { userId?: unknown }, ack: Ack): Promise<void> {
  const userId = typeof msg.userId === 'string' ? msg.userId : '';
  if (!userId || !canSee(player, userId)) return ack({ error: 'not-here' });
  try {
    ack({ skin: await store.get(userId) });
  } catch (err) {
    log.warn('could not read a skin', { err: err instanceof Error ? err.message : String(err) });
    ack({ error: 'unavailable' });
  }
}

/** `skin-set {skin}` → `{ skin }` as kept (null for the default), or `{ error }`. */
export async function handleSkinSet(player: Player, msg: { skin?: unknown }, ack: Ack): Promise<void> {
  const png = msg.skin === null ? null : parseSkinPng(msg.skin);
  if (msg.skin !== null && !png) return ack({ error: 'invalid' });
  try {
    if (png) await store.set(player.userId, png);
    else await store.remove(player.userId);
    ack({ skin: png });
  } catch (err) {
    log.warn('could not save a skin', { err: err instanceof Error ? err.message : String(err) });
    ack({ error: 'unavailable' });
  }
}
