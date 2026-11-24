import { itemDef, maxStackOf } from './items.js';

// A furnace, the block game's way: what is in its top slot cooks for 200 ticks
// (10 s) into its result in the output slot, while something from the fuel slot
// burns. Fuel is only taken when there is something to cook and room for what
// it makes; an item stops cooking (and loses its progress) when the fire goes
// out or the item is taken away. The playground service runs every furnace;
// the browser only shows one.

export const COOK_TICKS = 200;

const SMELTING: Readonly<Record<string, string>> = {
  iron_ore: 'iron_ingot',
  gold_ore: 'gold_ingot',
  sand: 'glass',
  cobblestone: 'stone',
  oak_log: 'charcoal',
  beef: 'cooked_beef',
  porkchop: 'cooked_porkchop',
  mutton: 'cooked_mutton',
  chicken: 'cooked_chicken',
};

interface FurnaceSlot { item: string; count: number; damage?: number }

export interface FurnaceState {
  /** input, fuel, output */
  slots: [FurnaceSlot | null, FurnaceSlot | null, FurnaceSlot | null];
  /** ticks of fire left, and how many the last fuel gave (for the flame's height) */
  burn: number;
  burnTotal: number;
  /** ticks the input has cooked */
  cook: number;
}

export const FURNACE_INPUT = 0;
export const FURNACE_FUEL = 1;
export const FURNACE_OUTPUT = 2;

export function createFurnace(): FurnaceState {
  return { slots: [null, null, null], burn: 0, burnTotal: 0, cook: 0 };
}

export function smeltResult(item: string): string | null {
  return SMELTING[item] ?? null;
}

export function fuelTicks(item: string): number {
  return itemDef(item)?.fuel ?? 0;
}

/** Whether the input can cook now: something smeltable, and room for its result. */
function canCook(furnace: FurnaceState): boolean {
  const input = furnace.slots[FURNACE_INPUT];
  const result = input ? smeltResult(input.item) : null;
  if (!result) return false;
  const output = furnace.slots[FURNACE_OUTPUT];
  return !output || (output.item === result && output.count < maxStackOf(result));
}

/** Whether the furnace is doing anything (burning, or able to light). */
export function furnaceActive(furnace: FurnaceState): boolean {
  return furnace.burn > 0 || (canCook(furnace) && !!furnace.slots[FURNACE_FUEL] && fuelTicks(furnace.slots[FURNACE_FUEL]!.item) > 0);
}

/** Runs the furnace `ticks` ticks on, in place. Returns whether its slots changed (not just its fire). */
export function stepFurnace(furnace: FurnaceState, ticks: number): boolean {
  let slotsChanged = false;
  for (let i = 0; i < ticks; i++) {
    if (furnace.burn <= 0 && !canCook(furnace)) {
      furnace.cook = 0;
      break;
    }
    if (furnace.burn > 0) furnace.burn--;
    const cooking = canCook(furnace);
    if (furnace.burn <= 0 && cooking) {
      const fuel = furnace.slots[FURNACE_FUEL];
      const ticksOfFuel = fuel ? fuelTicks(fuel.item) : 0;
      if (fuel && ticksOfFuel > 0) {
        furnace.burn = ticksOfFuel;
        furnace.burnTotal = ticksOfFuel;
        furnace.slots[FURNACE_FUEL] = fuel.count > 1 ? { ...fuel, count: fuel.count - 1 } : null;
        slotsChanged = true;
      }
    }
    if (furnace.burn > 0 && cooking) {
      furnace.cook++;
      if (furnace.cook >= COOK_TICKS) {
        furnace.cook = 0;
        const input = furnace.slots[FURNACE_INPUT]!;
        const result = smeltResult(input.item)!;
        const output = furnace.slots[FURNACE_OUTPUT];
        furnace.slots[FURNACE_OUTPUT] = { item: result, count: (output?.count ?? 0) + 1 };
        furnace.slots[FURNACE_INPUT] = input.count > 1 ? { ...input, count: input.count - 1 } : null;
        slotsChanged = true;
      }
    } else if (furnace.cook > 0) {
      // the game lets the progress slide back two ticks at a time
      furnace.cook = Math.max(0, furnace.cook - 2);
    }
  }
  return slotsChanged;
}
