import * as THREE from 'three';
import { stepDrop } from '@game/drops';
import type { Motion } from '@game/drops';
import type { BlockGrid } from '@game/grid';
import type { GroundItem } from '../worldState';
import type { ItemModel, ItemModels } from './itemModels';

// Items lying on the ground, as the block game shows them: each plays the fall
// the playground service worked out (the same steps from the same start,
// game/drops.ts), then turns slowly and bobs where it rests. One picked up
// flies into whoever took it. The fall steps at the game's 20 ticks a second,
// the very steps the service took to find where it lands; it is drawn between
// them at the frame rate, so it moves smoothly. An item heard of again (moved
// by a block that changed, or its stack changed) glides from where it was shown
// to where it now is instead of jumping.

const TICK_MS = 50;
/** a block's cube, and anything else's picture, on the ground */
const SCALE = { block: 0.25, flat: 0.5 } as const;
const PICKUP_MS = 150;
/** a fall plays at most this many ticks at once (an item that arrived resting is already there) */
const MAX_REPLAY_TICKS = 400;
/** how fast an item heard of again closes the gap to where it now is (per second) */
const GLIDE_RATE = 12;

interface Shown {
  model: ItemModel;
  motion: Motion;
  /** where the fall was a tick before `motion`, to draw it in between */
  previous: { x: number; y: number; z: number };
  /** what is left of the gap to where it was shown before it was heard of again; shrinks to nothing */
  glide: THREE.Vector3;
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
  private readonly lightAt: (x: number, y: number, z: number, out: THREE.Color) => THREE.Color;
  private readonly light = new THREE.Color();
  private readonly shown = new Map<number, Shown>();

  constructor(models: ItemModels, grid: () => BlockGrid | null, lightAt: (x: number, y: number, z: number, out: THREE.Color) => THREE.Color) {
    this.models = models;
    this.grid = grid;
    this.lightAt = lightAt;
  }

  /** An item appeared (or moved, or its stack changed): its fall plays from its start, as far along as it is. */
  add(item: GroundItem): void {
    const before = this.shown.get(item.id);
    const shownAt = before && !before.pickup ? this.at(before) : null;
    const age = before?.age ?? Math.random() * 10;
    this.drop(item.id);
    const model = this.models.create(item.item);
    if (!model) return;
    model.object.scale.setScalar(SCALE[model.shape]);
    this.group.add(model.object);
    const entry: Shown = {
      model, motion: { ...item.start }, previous: { ...item.start }, glide: new THREE.Vector3(), resting: false, sinceTick: 0, age, pickup: null,
    };
    const grid = this.grid();
    const since = item.age + performance.now() - item.receivedAt;
    const elapsed = Math.min(MAX_REPLAY_TICKS, Math.floor(since / TICK_MS));
    for (let i = 0; i < elapsed && grid && !entry.resting; i++) this.tick(entry, grid);
    // the part of a tick already under way, so it goes on from where it is in this one
    entry.sinceTick = elapsed < MAX_REPLAY_TICKS ? since % TICK_MS : 0;
    if (shownAt) entry.glide.copy(shownAt).sub(this.at(entry));
    this.shown.set(item.id, entry);
    this.place(entry);
  }

  private tick(entry: Shown, grid: BlockGrid): void {
    const { x, y, z } = entry.motion;
    entry.previous = { x, y, z };
    entry.resting = stepDrop(grid, entry.motion);
  }

  /** Where the fall is now: between its last two ticks, as far as the current one has gone; plus what is
   * left of its glide. */
  private at(entry: Shown, out = new THREE.Vector3()): THREE.Vector3 {
    const t = Math.min(1, entry.sinceTick / TICK_MS);
    const { previous, motion } = entry;
    return out.set(previous.x + (motion.x - previous.x) * t, previous.y + (motion.y - previous.y) * t, previous.z + (motion.z - previous.z) * t).add(entry.glide);
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

  private readonly where = new THREE.Vector3();

  private place(entry: Shown): void {
    const { object } = entry.model;
    const size = SCALE[entry.model.shape];
    const at = this.at(entry, this.where);
    // resting on its bottom, bobbing a little above it, turning slowly
    object.position.set(at.x, at.y + size / 2 + 0.05 + Math.sin(entry.age * 2) * 0.05, at.z);
    object.rotation.y = entry.age;
    entry.model.setLight(this.lightAt(at.x, at.y + 0.2, at.z, this.light));
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
          this.tick(entry, grid);
        }
      }
      // at rest, the last tick is played to its end
      if (entry.resting) entry.sinceTick = Math.min(TICK_MS, entry.sinceTick + dt * 1000);
      entry.glide.multiplyScalar(Math.exp(-GLIDE_RATE * dt));
      if (entry.glide.lengthSq() < 1e-6) entry.glide.set(0, 0, 0);
      this.place(entry);
    }
  }

  dispose(): void {
    for (const id of [...this.shown.keys()]) this.drop(id);
    this.group.removeFromParent();
  }
}
