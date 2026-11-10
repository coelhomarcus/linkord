import { useSyncExternalStore } from 'react';

// A share picked on the "send to" page waits here for the composer of the chosen
// conversation, which is not mounted yet when the pick is made. The composer
// takes it through its own addFiles, so the size, count and permission rules
// stay in one place.

export interface PendingShare {
  files: File[];
  text: string;
}

const EXPIRES_AFTER_MS = 60_000;

const pending = new Map<string, PendingShare & { expiresAt: number }>();
const listeners = new Set<() => void>();

const keyOf = (accountId: string, conversationId: string) => `${accountId}:${conversationId}`;
const notify = () => { for (const listener of listeners) listener(); };

/** Replaces an earlier share for the same conversation: the picker shows one at a time. */
export function queueShare(accountId: string, conversationId: string, share: PendingShare): void {
  pending.set(keyOf(accountId, conversationId), { ...share, expiresAt: Date.now() + EXPIRES_AFTER_MS });
  notify();
}

export function takeShare(accountId: string, conversationId: string): PendingShare | null {
  const key = keyOf(accountId, conversationId);
  const share = pending.get(key);
  if (!share) return null;
  pending.delete(key);
  notify();
  return share.expiresAt > Date.now() ? { files: share.files, text: share.text } : null;
}

export function clearPendingShares(): void {
  pending.clear();
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useHasPendingShare(accountId: string, conversationId: string): boolean {
  const key = keyOf(accountId, conversationId);
  return useSyncExternalStore(subscribe, () => pending.has(key));
}
