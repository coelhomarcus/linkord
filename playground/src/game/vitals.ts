import { itemDef } from './items.js';

// What keeps a player alive besides not being hit, the block game's way (1.8,
// on hard): falling, air and hunger. The playground service applies these to
// everyone (combat.ts); the browser runs the same rules only to show its own
// air and to know when it may eat.
//
// A landing deals a point for each block fallen past the third; water breaks
// any fall. A head under water has 300 ticks of air (15 s), then loses 2 health
// a second. Hunger is a food level (0..20, the shanks) with saturation on top:
// what the player does adds up as exhaustion, every 4 of which takes a point of
// saturation, or of food once saturation is gone. At 18 food or more a hurt
// player heals a point every 80 ticks (4 s), which costs exhaustion too; at 0
// food it loses one every 80 ticks instead, down to death.

export const MAX_FOOD = 20;
/** what a new life starts with, the game's */
export const START_SATURATION = 5;
/** ticks of air a head holds under water */
export const MAX_AIR = 300;
/** ticks the right button is held to eat something */
export const EAT_TICKS = 32;
/** a fall shorter than this hurts nobody */
export const SAFE_FALL = 3;
/** heals at or above this much food */
export const REGEN_FOOD = 18;
/** ticks between two points healed, or two lost to starvation */
export const FOOD_TICKS = 80;
/** after air runs out, a head under water loses this much every DROWN_TICKS */
export const DROWN_DAMAGE = 2;
const DROWN_TICKS = 20;
const EXHAUSTION_PER_POINT = 4;
const MAX_EXHAUSTION = 40;

/** What each thing a player does costs in exhaustion. */
export const EXHAUSTION = {
  /** per block sprinted on the ground */
  sprint: 0.1,
  jump: 0.2,
  sprintJump: 0.8,
  /** a hit that landed, for the one who dealt it and the one who took it */
  attack: 0.3,
  /** a block broken */
  dig: 0.025,
  /** a point healed */
  heal: 3,
} as const;

export interface Hunger {
  food: number;
  saturation: number;
  exhaustion: number;
  /** ticks toward the next heal or starvation */
  timer: number;
}

export function createHunger(): Hunger {
  return { food: MAX_FOOD, saturation: START_SATURATION, exhaustion: 0, timer: 0 };
}

/** What a landing after falling `distance` blocks deals (none into water: the caller knows where it landed). */
export function fallDamage(distance: number): number {
  return Number.isFinite(distance) ? Math.max(0, Math.ceil(distance - SAFE_FALL)) : 0;
}

/** What eating an item gives, or null for one that is not food. */
export function foodOf(item: string | null): { food: number; saturation: number } | null {
  return (item ? itemDef(item)?.food : undefined) ?? null;
}

/** Whether someone at `food` may start eating `item`: food, and not full. */
export function canEat(food: number, item: string | null): boolean {
  return foodOf(item) !== null && food < MAX_FOOD;
}

export function exhaust(hunger: Hunger, amount: number): void {
  if (amount > 0) hunger.exhaustion = Math.min(hunger.exhaustion + amount, MAX_EXHAUSTION);
}

/** Eats `item`, in place; false when it is not food. Saturation never passes the food level. */
export function eat(hunger: Hunger, item: string): boolean {
  const food = foodOf(item);
  if (!food) return false;
  hunger.food = Math.min(MAX_FOOD, hunger.food + food.food);
  hunger.saturation = Math.min(hunger.saturation + food.saturation, hunger.food);
  return true;
}

/** One tick of hunger, in place, for someone at `health` of `maxHealth`: 'heal' when a point comes
 * back now (its exhaustion is already counted), 'starve' when one is lost. */
export function stepHunger(hunger: Hunger, health: number, maxHealth: number): 'heal' | 'starve' | null {
  if (hunger.exhaustion > EXHAUSTION_PER_POINT) {
    hunger.exhaustion -= EXHAUSTION_PER_POINT;
    if (hunger.saturation > 0) hunger.saturation = Math.max(hunger.saturation - 1, 0);
    else hunger.food = Math.max(hunger.food - 1, 0);
  }
  if (hunger.food >= REGEN_FOOD && health > 0 && health < maxHealth) {
    if (++hunger.timer < FOOD_TICKS) return null;
    hunger.timer = 0;
    exhaust(hunger, EXHAUSTION.heal);
    return 'heal';
  }
  if (hunger.food <= 0) {
    if (++hunger.timer < FOOD_TICKS) return null;
    hunger.timer = 0;
    return 'starve';
  }
  hunger.timer = 0;
  return null;
}

/** One tick of air: back to full out of water; under it, one less, and once it has run out, a drowning
 * (`drown`) every DROWN_TICKS. */
export function stepAir(air: number, underwater: boolean): { air: number; drown: boolean } {
  if (!underwater) return { air: MAX_AIR, drown: false };
  const next = air - 1;
  return next <= -DROWN_TICKS ? { air: 0, drown: true } : { air: next, drown: false };
}

/** Whether eyes at height `eyeY` above (x, z) are under water: in a water cell, below the top ninth that a
 * surface block leaves open. */
export function headInWater(isWater: (x: number, y: number, z: number) => boolean, x: number, eyeY: number, z: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(eyeY);
  const cz = Math.floor(z);
  if (!isWater(cx, cy, cz)) return false;
  return isWater(cx, cy + 1, cz) || eyeY < cy + 8 / 9;
}

/** How many bubbles the HUD shows for `air` (the game's): whole ones, and one popping. */
export function airBubbles(air: number): { full: number; popping: number } {
  const full = Math.ceil(((air - 2) * 10) / MAX_AIR);
  const total = Math.ceil((air * 10) / MAX_AIR);
  return { full: Math.max(0, full), popping: Math.max(0, total - Math.max(0, full)) };
}
