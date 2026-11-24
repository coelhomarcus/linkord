// A playground's clock, the block game's way: a day is 24000 ticks (20 minutes
// at 20 ticks a second), tick 0 is sunrise (6:00), 6000 noon, 12000 sunset and
// 18000 midnight. The playground service counts it while anyone is in the world
// and saves it with the world; the browser counts on from what it was told and
// draws the sky, the sun, the moon and the world's light from it.
//
// The sun's path and the darkening of the sky light follow the game as
// minecraft-renderer reproduces it (lib/skyLight.ts in
// github.com/zardoy/minecraft-renderer, MIT, Copyright (c) 2020 PrismarineJS).

export const DAY_TICKS = 24_000;
/** a new world starts in the morning, an hour after sunrise */
export const NEW_WORLD_TIME = 1000;
/** the moon's eight phases, a day each */
const MOON_PHASES = 8;
/** the clock is kept below this (whole cycles of the moon), so a stored time never grows without end */
const CLOCK_WRAP = DAY_TICKS * MOON_PHASES * 1000;
/** how many steps the sky light loses at the darkest of the night (15 becomes 4) */
export const MAX_SKY_DARKEN = 11;

/** The clock after `ticks` more, kept below its wrap. */
export function advanceClock(clock: number, ticks: number): number {
  return (clock + ticks) % CLOCK_WRAP;
}

/** A stored clock, or a new world's for anything that is not one. */
export function readClock(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value % CLOCK_WRAP : NEW_WORLD_TIME;
}

/** The time of day, 0..24000, of a clock. */
export function timeOfDay(clock: number): number {
  return ((clock % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
}

/** The moon's phase, 0 (full) to 7. */
export function moonPhase(clock: number): number {
  return Math.floor(Math.max(0, clock) / DAY_TICKS) % MOON_PHASES;
}

/** Where the sun is in its turn around the world: 0 overhead at noon, 0.25 setting, 0.5 under the
 * world at midnight, 0.75 rising. The game eases it so days are a little longer than nights. */
export function celestialAngle(clock: number): number {
  const t = timeOfDay(clock) / DAY_TICKS - 0.25;
  const d = t - Math.floor(t);
  const eased = 0.5 - Math.cos(d * Math.PI) / 2;
  return (d * 2 + eased) / 3;
}

/** How much of the day's light the sky gives, 0 (night) to 1 (day), with a short twilight between. */
export function daylight(clock: number): number {
  const brightness = Math.cos(celestialAngle(clock) * Math.PI * 2) * 2 + 0.5;
  return Math.max(0, Math.min(1, brightness));
}

/** How many steps the sky light loses now: 0 by day, 11 at night (a cell open to the sky is 15 by
 * day and 4 at night). A fraction in the twilight, so the light dims smoothly. */
export function skyDarken(clock: number): number {
  return (1 - daylight(clock)) * MAX_SKY_DARKEN;
}
