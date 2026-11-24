import * as THREE from 'three';
import { stepDrop } from '@game/drops';
import type { Motion } from '@game/drops';
import type { BlockGrid } from '@game/grid';
import type { GroundItem } from '../worldState';
import type { ItemModel, ItemModels } from './itemModels';

// Items lying on the ground, as the block game shows them: each plays the fall
// the playground service worked out (the same steps from the same start,
// game/drops.ts), then turns slowly and bobs where it rests. One picked up
// flies into whoever took it.

const TICK_MS = 50;
/** a block's cube, and anything else's picture, on the ground */
const SCALE = { block: 0.25, flat: 0.5 } as const;
const PICKUP_MS = 150;
/** a fall plays at most this many ticks at once (an item that arrived resting is already there) */
const MAX_REPLAY_TICKS = 400;

interface Shown {
  model: ItemModel;
  motion: Motion;
  resting: boolean;
  /** ticks played, and the time since the last one */
  sinceTick: number;
  /** seconds since it appeared, for the turning and the bob */
  age: number;
  /** flying to whoever picked it up */
  pickup: { at: number; from: THREE.Vector3; toward: () => THREE.Vector3 | null } | null;
}

export class DroppedItems {
  readonly group = new THREE.Group();
  private readonly models: ItemModels;
  private readonly grid: () => BlockGrid | null;
  private readonly lightAt: (x: number, y: number, z: number) => number;
  private readonly shown = new Map<number, Shown>();

  constructor(models: ItemModels, grid: () => BlockGrid | null, lightAt: (x: number, y: number, z: number) => number) {
    this.models = models;
    this.grid = grid;
    this.lightAt = lightAt;
  }

  /** An item appeared (or moved, or its stack changed): its fall plays from its start, as far along as it is. */
  add(item: GroundItem): void {
    this.drop(item.id);
    const model = this.models.create(item.item);
    if (!model) return;
    model.object.scale.setScalar(SCALE[model.shape]);
    this.group.add(model.object);
    const entry: Shown = { model, motion: { ...item.start }, resting: false, sinceTick: 0, age: Math.random() * 10, pickup: null };
    const grid = this.grid();
    const elapsed = Math.min(MAX_REPLAY_TICKS, Math.floor((item.age + performance.now() - item.receivedAt) / TICK_MS));
    for (let i = 0; i < elapsed && grid && !entry.resting; i++) entry.resting = stepDrop(grid, entry.motion);
    this.shown.set(item.id, entry);
    this.place(entry);
  }

  /** Gone: picked up by whoever `toward` follows (it flies to them first), or vanished. */
  remove(id: number, toward: (() => THREE.Vector3 | null) | null): void {
    const entry = this.shown.get(id);
    if (!entry) return;
    if (!toward) {
      this.drop(id);
      return;
    }
    entry.pickup = { at: 0, from: entry.model.object.position.clone(), toward };
  }

  /** Everything from scratch (the world arrived again). */
  reset(items: Iterable<GroundItem>): void {
    for (const id of [...this.shown.keys()]) this.drop(id);
    for (const item of items) this.add(item);
  }

  private drop(id: number): void {
    const entry = this.shown.get(id);
    if (!entry) return;
    entry.model.dispose();
    this.shown.delete(id);
  }

  private place(entry: Shown): void {
    const { object } = entry.model;
    const size = SCALE[entry.model.shape];
    // resting on its bottom, bobbing a little above it, turning slowly
    object.position.set(entry.motion.x, entry.motion.y + size / 2 + 0.05 + Math.sin(entry.age * 2) * 0.05, entry.motion.z);
    object.rotation.y = entry.age;
    entry.model.setLight(this.lightAt(entry.motion.x, entry.motion.y + 0.2, entry.motion.z));
  }

  update(dt: number): void {
    const grid = this.grid();
    for (const [id, entry] of this.shown) {
      entry.age += dt;
      if (entry.pickup) {
        entry.pickup.at += dt * 1000;
        const target = entry.pickup.toward();
        const t = Math.min(1, entry.pickup.at / PICKUP_MS);
        if (!target || t >= 1) {
          this.drop(id);
          continue;
        }
        entry.model.object.position.lerpVectors(entry.pickup.from, target, t * t);
        continue;
      }
      if (!entry.resting && grid) {
        entry.sinceTick += dt * 1000;
        while (entry.sinceTick >= TICK_MS && !entry.resting) {
          entry.sinceTick -= TICK_MS;
          entry.resting = stepDrop(grid, entry.motion);
        }
      }
      this.place(entry);
    }
  }

  dispose(): void {
    for (const id of [...this.shown.keys()]) this.drop(id);
    this.group.removeFromParent();
  }
}
