import { and, eq, sql } from 'drizzle-orm';
import type { PlaygroundDb } from './db/client.js';
import { playgroundExperience } from './db/schema.js';

// Where experience is kept between connections and restarts. A kill adds to the
// stored total in one statement, so two kills at once both count and a total read
// before a failed load is never written over a larger one.

export interface ExperienceStore {
  /** the points an account has in a playground (0 when it never earned any) */
  load(conversationId: string, userId: string): Promise<number>;
  /** adds `points` and returns the new total */
  add(conversationId: string, userId: string, points: number): Promise<number>;
}

export function databaseExperienceStore(db: PlaygroundDb): ExperienceStore {
  return {
    async load(conversationId, userId) {
      const [row] = await db.select({ points: playgroundExperience.points }).from(playgroundExperience)
        .where(and(eq(playgroundExperience.conversationId, conversationId), eq(playgroundExperience.userId, userId))).limit(1);
      return row?.points ?? 0;
    },
    async add(conversationId, userId, points) {
      const [row] = await db.insert(playgroundExperience).values({ conversationId, userId, points })
        .onConflictDoUpdate({
          target: [playgroundExperience.conversationId, playgroundExperience.userId],
          set: { points: sql`${playgroundExperience.points} + ${points}`, updatedAt: new Date() },
        })
        .returning({ points: playgroundExperience.points });
      return row?.points ?? points;
    },
  };
}

/** Kept in memory only: what tests use, and what a service without its database would do. */
export function memoryExperienceStore(): ExperienceStore {
  const points = new Map<string, number>();
  const key = (conversationId: string, userId: string) => `${conversationId}:${userId}`;
  return {
    async load(conversationId, userId) {
      return points.get(key(conversationId, userId)) ?? 0;
    },
    async add(conversationId, userId, added) {
      const total = (points.get(key(conversationId, userId)) ?? 0) + added;
      points.set(key(conversationId, userId), total);
      return total;
    },
  };
}
