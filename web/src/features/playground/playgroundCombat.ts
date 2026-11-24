import { useSyncExternalStore } from 'react';
import type { ServerMessage } from '@/shared/types/protocol';

// What this client knows of the fighting in a playground. The server decides
// every hit and every point of health (server/src/modules/playground/combat.ts);
// this keeps the last word it said, counts the regeneration it will do in the
// meantime with the same rule (1 point every 4 s, from when the health last
// changed), hands each hit to the 3D view for its effects, and remembers who is
// dead. It lives in the PlaygroundSession, so it outlives the view.

export const MAX_HEALTH = 20;
const REGEN_INTERVAL_MS = 4000;

export type PlaygroundHit = Extract<ServerMessage, { t: 'playground-hit' }>;
type PlaygroundHealth = Extract<ServerMessage, { t: 'playground-health' }>;

/** The local player's health as the HUD shows it. */
export interface Vitals {
  health: number;
  /** the health before the last change, which the hearts blink */
  previousHealth: number;
  /** what the last change was: the hearts blink longer for a hurt than for a heal */
  lastChange: 'hurt' | 'heal' | null;
  /** bumped by every hit that hurt you, so the hearts blink */
  hurts: number;
  /** bumped whenever the health goes up, a smaller blink */
  heals: number;
  /** who dealt the killing blow (a connection id), while dead */
  killerId: string | null;
}

/** Whether a punch now is a critical one, by the game's rule: in the air and on the way down. */
export function isCriticalHit(body: { onGround: boolean }, fallDistance: number): boolean {
  return !body.onGround && fallDistance > 0;
}

const FULL: Vitals = { health: MAX_HEALTH, previousHealth: MAX_HEALTH, lastChange: null, hurts: 0, heals: 0, killerId: null };
const noSubscription = () => () => {};
const fullHealth = () => FULL;

/** Your health in a playground (full outside one). */
export function useVitals(combat: PlaygroundCombat | null): Vitals {
  return useSyncExternalStore(combat?.subscribe ?? noSubscription, combat?.getVitals ?? fullHealth);
}

export class PlaygroundCombat {
  private readonly localId: string;
  private vitals: Vitals = FULL;
  /** health the server last said, and when (performance.now()) */
  private baseHealth = MAX_HEALTH;
  private baseAt = 0;
  private regenTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private hits: PlaygroundHit[] = [];
  /** everyone else who is dead now */
  readonly dead = new Set<string>();

  constructor(localId: string) {
    this.localId = localId;
  }

  getVitals = (): Vitals => this.vitals;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  get isDead(): boolean {
    return this.vitals.health <= 0;
  }

  /** The hits since the last call, oldest first (the 3D view plays them). */
  takeHits(): PlaygroundHit[] {
    const hits = this.hits;
    this.hits = [];
    return hits;
  }

  /** A message from the server about this call's fighting. */
  receive(message: PlaygroundHit | PlaygroundHealth, now = performance.now()): void {
    if (message.t === 'playground-hit') {
      this.hits.push(message);
      if (this.hits.length > 64) this.hits.shift();
      this.setHealthOf(message.targetId, message.health, now, message.hurt, message.attackerId);
      return;
    }
    for (const { id, health } of message.players) this.setHealthOf(id, health, now, false, null);
  }

  private setHealthOf(id: string, health: number, now: number, hurt: boolean, attackerId: string | null): void {
    if (!Number.isFinite(health)) return;
    if (id !== this.localId) {
      if (health <= 0) this.dead.add(id);
      else this.dead.delete(id);
      return;
    }
    const previous = this.vitals.health;
    this.baseHealth = Math.max(0, Math.min(MAX_HEALTH, health));
    this.baseAt = now;
    const healed = this.baseHealth > previous;
    this.update({
      health: this.baseHealth,
      previousHealth: previous,
      lastChange: hurt ? 'hurt' : healed ? 'heal' : this.vitals.lastChange,
      hurts: this.vitals.hurts + (hurt ? 1 : 0),
      heals: this.vitals.heals + (healed ? 1 : 0),
      killerId: this.baseHealth <= 0 ? attackerId : null,
    });
  }

  private update(vitals: Vitals): void {
    const changed = vitals.health !== this.vitals.health || vitals.hurts !== this.vitals.hurts || vitals.heals !== this.vitals.heals || vitals.killerId !== this.vitals.killerId || vitals.previousHealth !== this.vitals.previousHealth;
    if (changed) {
      this.vitals = vitals;
      for (const listener of this.listeners) listener();
    }
    this.scheduleRegen();
  }

  /** The server heals 1 point every REGEN_INTERVAL_MS from the last change; shown when it does. */
  private scheduleRegen(): void {
    if (this.regenTimer) clearTimeout(this.regenTimer);
    this.regenTimer = null;
    const { health } = this.vitals;
    if (health <= 0 || health >= MAX_HEALTH) return;
    const due = this.baseAt + (Math.floor(health - this.baseHealth) + 1) * REGEN_INTERVAL_MS;
    this.regenTimer = setTimeout(() => {
      this.regenTimer = null;
      const healed = Math.min(MAX_HEALTH, this.baseHealth + Math.floor((performance.now() - this.baseAt) / REGEN_INTERVAL_MS));
      if (healed > this.vitals.health) this.update({ ...this.vitals, health: healed, previousHealth: this.vitals.health, lastChange: 'heal', heals: this.vitals.heals + 1 });
      else this.scheduleRegen();
    }, Math.max(0, due - performance.now()));
  }

  dispose(): void {
    if (this.regenTimer) clearTimeout(this.regenTimer);
    this.regenTimer = null;
    this.listeners.clear();
  }
}
