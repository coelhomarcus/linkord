import { db } from '../../db/client.js';
import { playgroundForgottenAccounts } from '../../db/schema.js';

type Executor = Pick<typeof db, 'insert'>;

/** Called in the transaction that deletes an account, so the two never part. Games keep what they
 * know of an account (a block game's skin and experience) in their own databases; the queue waits
 * here until games can be told (LINKORD-158), so nobody deleted in between is missed. */
export async function queueAccountDeletionForGames(tx: Executor, userId: string): Promise<void> {
  await tx.insert(playgroundForgottenAccounts).values({ userId }).onConflictDoNothing();
}
