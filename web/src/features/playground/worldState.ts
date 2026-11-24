import { BLOCK, isBlock } from '@game/blocks';
import { advanceClock, NEW_WORLD_TIME, readClock } from '@game/dayTime';
import type { Block } from '@game/blocks';
import type { Motion } from '@game/drops';
import { BlockGrid, CELL_COUNT } from '@game/grid';
import type { Facing } from '@game/worldGen';

// This browser's copy of the playground's world. The playground service keeps
// the one that counts (playground/src/worlds.ts) and sends it whole when the
// link connects (`world-get`, the blocks deflated), then every change as it
// happens. A change this player asks for (a block broken or placed) is shown at
// once (`predict`); the service's answer confirms it or puts the block back.
// The 3D view listens for changes to redraw what they touch. The world's clock
// arrives with it and runs on here at the game's 20 ticks a second.

export interface FurnaceLook { x: number; y: number; z: number; facing: Facing; lit: boolean }

export interface GroundItem {
  id: number;
  item: string;
  count: number;
  /** where its fall started, and how it was thrown */
  start: Motion;
  /** how old it was when it arrived (ms), and when that was (performance.now()) */
  age: number;
  receivedAt: number;
}

export type WorldEvent =
  | { kind: 'loaded' }
  | { kind: 'blocks'; cells: [number, number, number][] }
  | { kind: 'items'; added: GroundItem[]; removed: number[]; by: string | null }
  | { kind: 'furnace'; look: FurnaceLook }
  | { kind: 'held'; ids: string[] };

const furnaceKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
const TICK_MS = 50;

/** The deflated blocks the service sends, back to one byte a cell. */
export async function inflateBlocks(bytes: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

function readMotion(value: unknown): Motion | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, z, vx, vy, vz } = value as Record<string, unknown>;
  const all = [x, y, z, vx, vy, vz];
  return all.every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x, y, z, vx, vy, vz } as Motion : null;
}

function readItem(value: unknown, now: number): GroundItem | null {
  if (!value || typeof value !== 'object') return null;
  const { id, item, count, start, age } = value as Record<string, unknown>;
  const motion = readMotion(start);
  if (!isInt(id) || typeof item !== 'string' || !isInt(count) || !motion) return null;
  return { id, item, count, start: motion, age: typeof age === 'number' && age > 0 ? age : 0, receivedAt: now };
}

function readLook(value: unknown): FurnaceLook | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, z, facing, lit } = value as Record<string, unknown>;
  if (!isInt(x) || !isInt(y) || !isInt(z) || !BlockGrid.inside(x, y, z)) return null;
  return { x, y, z, facing: ([0, 1, 2, 3].includes(facing as number) ? facing : 0) as Facing, lit: lit === true };
}

export class WorldState {
  grid: BlockGrid | null = null;
  readonly furnaces = new Map<string, FurnaceLook>();
  readonly items = new Map<number, GroundItem>();
  /** what each connection in the call holds (an item id), as the service says */
  readonly held = new Map<string, string | null>();
  /** the clock as last heard, and when (performance.now()) */
  private clockHeard = { clock: NEW_WORLD_TIME, at: performance.now() };
  private readonly listeners = new Set<(event: WorldEvent) => void>();

  subscribe(listener: (event: WorldEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(event: WorldEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /** The world as the service sent it (`world-get`'s answer, the blocks already inflated). */
  load(blocks: Uint8Array, states: Uint8Array | null, answer: { furnaces?: unknown; items?: unknown; held?: unknown; clock?: unknown }): void {
    if (blocks.length !== CELL_COUNT) return;
    this.applyClock(answer.clock);
    this.grid = BlockGrid.from(blocks, states);
    this.furnaces.clear();
    for (const entry of Array.isArray(answer.furnaces) ? answer.furnaces : []) {
      const look = readLook(entry);
      if (look) this.furnaces.set(furnaceKey(look.x, look.y, look.z), look);
    }
    this.items.clear();
    const now = performance.now();
    for (const entry of Array.isArray(answer.items) ? answer.items : []) {
      const item = readItem(entry, now);
      if (item) this.items.set(item.id, item);
    }
    this.held.clear();
    this.applyHeld(answer.held, false);
    this.emit({ kind: 'loaded' });
  }

  /** `playground-time`: the world's clock now (a service from before the clock sends none: morning). */
  applyClock(clock: unknown): void {
    this.clockHeard = { clock: readClock(clock), at: performance.now() };
  }

  /** The world's clock in ticks at `now` (performance.now()), with the fraction of the tick under way. */
  clock(now: number): number {
    return advanceClock(this.clockHeard.clock, Math.max(0, now - this.clockHeard.at) / TICK_MS);
  }

  get loaded(): boolean {
    return this.grid !== null;
  }

  furnaceAt(x: number, y: number, z: number): FurnaceLook | null {
    return this.furnaces.get(furnaceKey(x, y, z)) ?? null;
  }

  /** A change this player asked for, shown before the service answers. */
  predict(x: number, y: number, z: number, block: Block, state = 0): void {
    if (!this.grid || !BlockGrid.inside(x, y, z)) return;
    this.grid.set(x, y, z, block, state);
    this.emit({ kind: 'blocks', cells: [[x, y, z]] });
  }

  /** `playground-blocks`: blocks that changed (or, to this player alone, the truth about one it guessed),
   * `[x, y, z, block, state?]` each. */
  applyBlocks(changes: unknown): void {
    if (!this.grid || !Array.isArray(changes)) return;
    const cells: [number, number, number][] = [];
    for (const change of changes) {
      if (!Array.isArray(change)) continue;
      const [x, y, z, block, state] = change as unknown[];
      if (!isInt(x) || !isInt(y) || !isInt(z) || !isInt(block) || !isBlock(block) || !BlockGrid.inside(x, y, z)) continue;
      this.grid.set(x, y, z, block, isInt(state) ? state : 0);
      if (block !== BLOCK.furnace) this.furnaces.delete(furnaceKey(x, y, z));
      cells.push([x, y, z]);
    }
    if (cells.length) this.emit({ kind: 'blocks', cells });
  }

  /** `playground-items`: items that appeared (or moved), and items gone (`by` someone who took them). */
  applyItems(message: { add?: unknown; remove?: unknown; by?: unknown }): void {
    const now = performance.now();
    const added: GroundItem[] = [];
    for (const entry of Array.isArray(message.add) ? message.add : []) {
      const item = readItem(entry, now);
      if (!item) continue;
      this.items.set(item.id, item);
      added.push(item);
    }
    const removed = (Array.isArray(message.remove) ? message.remove : []).filter(isInt);
    for (const id of removed) this.items.delete(id);
    if (added.length || removed.length) this.emit({ kind: 'items', added, removed, by: typeof message.by === 'string' ? message.by : null });
  }

  /** `playground-furnace`: a furnace placed, lit or gone out. */
  applyFurnace(message: unknown): void {
    const look = readLook(message);
    if (!look) return;
    this.furnaces.set(furnaceKey(look.x, look.y, look.z), look);
    this.emit({ kind: 'furnace', look });
  }

  /** `playground-held`: what some connections hold now. */
  applyHeld(players: unknown, emit = true): void {
    const ids: string[] = [];
    for (const entry of Array.isArray(players) ? players : []) {
      const { id, item } = (entry ?? {}) as Record<string, unknown>;
      if (typeof id !== 'string') continue;
      this.held.set(id, typeof item === 'string' ? item : null);
      ids.push(id);
    }
    if (emit && ids.length) this.emit({ kind: 'held', ids });
  }

  dispose(): void {
    this.listeners.clear();
  }
}
