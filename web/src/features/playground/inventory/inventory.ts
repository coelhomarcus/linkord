import { useSyncExternalStore } from 'react';
import { applyOp, createInventory, parseFurnace, parseInventory, parseStack } from '@game/inventory';
import type { Inventory, InventoryOp, OpenContainer, Window } from '@game/inventory';
import type { FurnaceState } from '@game/smelting';

// What this player carries, as the playground service keeps it
// (playground/src/inventories.ts), with this player's own changes shown on top
// before the service confirms them: every click, key or block placed is
// applied here at once by the same rules the service runs (game/inventory.ts)
// and sent with a running number; each answer (`playground-inv`) says the last
// number it handled, and the changes up to there give way to what it says.

export interface InventorySnapshot {
  ack: number;
  inventory: Inventory;
  furnace: FurnaceState | null;
}

/** Sends a request carrying `seq`; false when the link is down (nothing is predicted then). */
export type SendInventoryRequest = (seq: number) => boolean;

interface Pending { seq: number; change: (window: Window) => Window }

function readOpen(value: unknown): OpenContainer | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, x, y, z } = value as Record<string, unknown>;
  if ((kind !== 'table' && kind !== 'furnace') || ![x, y, z].every((n) => typeof n === 'number' && Number.isInteger(n))) return null;
  return { kind, x: x as number, y: y as number, z: z as number };
}

/** A `playground-inv` message, read defensively. */
export function readSnapshot(message: Record<string, unknown>): InventorySnapshot | null {
  const raw = message.inventory as Record<string, unknown> | undefined;
  const base = parseInventory(raw);
  if (!base || !raw) return null;
  const open = readOpen(raw.open);
  const grid = Array.isArray(raw.grid) && (raw.grid.length === 4 || raw.grid.length === 9) ? raw.grid.map(parseStack) : createInventory().grid;
  const inventory: Inventory = { ...base, cursor: parseStack(raw.cursor), grid, open };
  return { ack: typeof message.ack === 'number' ? message.ack : 0, inventory, furnace: open?.kind === 'furnace' && message.furnace ? parseFurnace(message.furnace) : null };
}

export class InventoryState {
  private base: Window = { inventory: createInventory(), furnace: null };
  private pending: Pending[] = [];
  private shown: Window = this.base;
  private seq = 0;
  /** when the furnace was last heard of (performance.now()), to show its progress in between */
  furnaceAt = 0;
  private readonly listeners = new Set<() => void>();

  get = (): Inventory => this.shown.inventory;
  getWindow = (): Window => this.shown;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private refresh(): void {
    const shown = this.pending.reduce((window, { change }) => change(window), this.base);
    if (shown.inventory === this.shown.inventory && shown.furnace === this.shown.furnace) return;
    this.shown = shown;
    for (const listener of this.listeners) listener();
  }

  /** Shows `change` now and sends the request that makes it (`send` gets its number). */
  predict(change: (window: Window) => Window, send: SendInventoryRequest): boolean {
    const seq = ++this.seq;
    if (!send(seq)) return false;
    this.pending.push({ seq, change });
    this.refresh();
    return true;
  }

  /** An inventory operation, shown now and sent. */
  perform(op: InventoryOp, send: (seq: number, op: InventoryOp) => boolean): boolean {
    return this.predict((window) => applyOp(window, op).window, (seq) => send(seq, op));
  }

  /** What the service says: everything up to `ack` is in it. */
  receive(snapshot: InventorySnapshot): void {
    this.base = { inventory: snapshot.inventory, furnace: snapshot.furnace };
    this.furnaceAt = performance.now();
    this.pending = this.pending.filter((entry) => entry.seq > snapshot.ack);
    this.refresh();
  }

  /** A new connection to the service: nothing sent before it will be answered. */
  forgetPending(): void {
    this.pending = [];
    this.refresh();
  }
}

const EMPTY = createInventory();
const noSubscription = () => () => {};
const NO_WINDOW: Window = { inventory: EMPTY, furnace: null };
const noWindow = () => NO_WINDOW;

export function useInventoryWindow(store: InventoryState | null): Window {
  return useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getWindow ?? noWindow);
}
