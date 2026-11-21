import { useSyncExternalStore } from 'react';

// Which conversation's pins are open in the header popover. A store rather
// than state in the header: a pin notice deep in the timeline opens it too.
let openFor: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openPinsPanel(conversationId: string): void {
  if (openFor === conversationId) return;
  openFor = conversationId;
  emit();
}

export function closePinsPanel(): void {
  if (openFor === null) return;
  openFor = null;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while this conversation's pins are open. */
export function usePinsPanelOpen(conversationId: string): boolean {
  return useSyncExternalStore(subscribe, () => openFor === conversationId, () => false);
}
