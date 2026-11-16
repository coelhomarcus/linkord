import { fetchRelationship } from '@/shared/api/api';
import type { Relation, Relationship } from '@/shared/api/api';
import { createResourceCache, onResourceCachesCleared, useResource } from '@/shared/lib/resourceCache';
import { useRoomSelector, useRoomState } from '@/state/RoomContext';
import { useFriends } from './FriendsContext';

export type RelationshipState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: Relationship };

/** The viewer's relation to each account, shared by every profile surface:
 * the mini profile, the modal and a DM's composer read one answer. */
const relationships = createResourceCache<Relationship>((userId) => fetchRelationship(userId));

const FRIENDS: Relationship = { relation: 'friends', retryAfter: null };
const SELF: Relationship = { relation: 'self', retryAfter: null };

/** The viewer's relation to one account, kept current: refetches when the
 * social revision moves (a second tab accepted, the other side blocked...).
 * What is already known renders at once — a cached answer, yourself, a friend
 * from the live friends list — and the read only confirms it; an account
 * never seen reads as loading, never as another account's relation. */
export function useRelationship(userId: string | null): { state: RelationshipState; retry: () => void } {
  const { revision } = useFriends();
  const { me } = useRoomState('me');
  const isFriend = useRoomSelector((room) => !!userId && room.friendUserIds.has(userId));
  const self = !!userId && userId === me.userId;
  const resource = useResource(relationships, self ? null : userId, revision);
  const entry = resource.entry;

  let state: RelationshipState = { status: 'loading' };
  if (!userId) state = { status: 'loading' };
  else if (self) state = { status: 'ready', value: SELF };
  else if (entry?.hasValue && entry.value) {
    // a value read before the last social change may be out of date: the
    // live friends list settles friendship until the new read lands
    const fresh = entry.local || entry.token === revision;
    if (fresh || entry.value.relation !== 'friends') state = { status: 'ready', value: isFriend && !fresh ? FRIENDS : entry.value };
    else if (isFriend) state = { status: 'ready', value: FRIENDS };
  } else if (isFriend) state = { status: 'ready', value: FRIENDS };
  else if (resource.status === 'error') state = { status: 'error' };

  return { state, retry: resource.retry };
}

// one change at a time per account: the next waits for the one before, so the
// server sees them in the order they were clicked
const queues = new Map<string, Promise<unknown>>();
const QUEUE_WAIT_MS = 10_000;
onResourceCachesCleared(() => queues.clear());

/** Raised for a change that never ran because the one queued before it failed. */
export class SupersededChange extends Error {}

/** Shows `optimistic` at once and runs `action`. `confirmed` turns the server's
 * answer into the relation it means, when that can differ. If the server
 * refuses, what was known before comes back (unless something newer replaced
 * the optimistic value meanwhile) and the relation is read again. */
export function changeRelationship<R>(
  userId: string,
  optimistic: Relation,
  action: () => Promise<R>,
  confirmed?: (result: R) => Relation,
): Promise<R> {
  const before = relationships.peek(userId);
  relationships.set(userId, { relation: optimistic, retryAfter: null });
  const mine = relationships.peek(userId);
  const restore = () => {
    if (relationships.peek(userId) !== mine) return;
    if (before?.hasValue && before.value) relationships.set(userId, before.value, { local: before.local });
    else relationships.delete(userId);
  };

  const queued = queues.get(userId);
  // a request that hangs (no answer, no error) must not hold every later click back for good
  const previous = queued ? Promise.race([queued, new Promise((resolve) => { setTimeout(resolve, QUEUE_WAIT_MS); })]) : Promise.resolve();
  const run = previous.then(
    () => action(),
    () => { throw new SupersededChange(); },
  ).then(
    (result) => {
      if (confirmed && relationships.peek(userId) === mine) relationships.set(userId, { relation: confirmed(result), retryAfter: null });
      return result;
    },
    (error: unknown) => {
      // what came before a superseded change was itself never confirmed: only the server can say
      if (!(error instanceof SupersededChange)) restore();
      void relationships.load(userId, Symbol('rollback')).catch(() => {});
      throw error;
    },
  );
  const settled = run.finally(() => { if (queues.get(userId) === settled) queues.delete(userId); });
  queues.set(userId, settled);
  // the queue itself must not report an unhandled rejection: the caller does
  settled.catch(() => {});
  return run;
}
