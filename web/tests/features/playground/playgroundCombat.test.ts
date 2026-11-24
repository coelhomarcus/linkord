import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCriticalHit, MAX_HEALTH, PlaygroundCombat } from '@/features/playground/playgroundCombat';
import type { PlaygroundHit } from '@/features/playground/playgroundCombat';

const hit = (overrides: Partial<PlaygroundHit> = {}): PlaygroundHit => ({
  t: 'playground-hit', conversationId: 'conv', attackerId: 'them', targetId: 'me', damage: 1, health: 19, crit: false, hurt: true, push: [0.4, 0], ...overrides,
});

describe('isCriticalHit', () => {
  it('is a punch in the air on the way down', () => {
    expect(isCriticalHit({ onGround: false }, 0.3)).toBe(true);
    expect(isCriticalHit({ onGround: false }, 0)).toBe(false);
    expect(isCriticalHit({ onGround: true }, 0)).toBe(false);
  });
});

describe('PlaygroundCombat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows the health the server says, counts the hurts and hands the hits to the view once', () => {
    const combat = new PlaygroundCombat('me');
    const listener = vi.fn();
    combat.subscribe(listener);
    combat.receive(hit());
    combat.receive(hit({ targetId: 'other', health: 12 }));
    expect(combat.getVitals()).toEqual({ health: 19, previousHealth: 20, lastChange: 'hurt', hurts: 1, heals: 0, killerId: null, xp: 0, xpKnown: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(combat.takeHits().map((h) => h.targetId)).toEqual(['me', 'other']);
    expect(combat.takeHits()).toEqual([]);
  });

  it('heals 1 every 4 s from the last change, as the server does', () => {
    const combat = new PlaygroundCombat('me');
    combat.receive(hit({ health: 17 }), performance.now());
    vi.advanceTimersByTime(3999);
    expect(combat.getVitals().health).toBe(17);
    vi.advanceTimersByTime(1);
    expect(combat.getVitals()).toMatchObject({ health: 18, previousHealth: 17, lastChange: 'heal', heals: 1 });
    vi.advanceTimersByTime(4000 * 10);
    expect(combat.getVitals().health).toBe(MAX_HEALTH);
    combat.dispose();
  });

  it('dies at 0, remembering who did it, and lives again on the server\'s word', () => {
    const combat = new PlaygroundCombat('me');
    combat.receive(hit({ health: 0 }));
    expect(combat.isDead).toBe(true);
    expect(combat.getVitals().killerId).toBe('them');
    vi.advanceTimersByTime(60_000);
    expect(combat.getVitals().health).toBe(0);
    combat.receive({ t: 'playground-health', conversationId: 'conv', players: [{ id: 'me', health: MAX_HEALTH }] });
    expect(combat.isDead).toBe(false);
    expect(combat.getVitals().killerId).toBeNull();
  });

  it('keeps track of who else is dead', () => {
    const combat = new PlaygroundCombat('me');
    combat.receive(hit({ targetId: 'other', health: 0 }));
    expect(combat.dead.has('other')).toBe(true);
    combat.receive({ t: 'playground-health', conversationId: 'conv', players: [{ id: 'other', health: MAX_HEALTH }] });
    expect(combat.dead.has('other')).toBe(false);
  });

  it('keeps the experience the server says', () => {
    const combat = new PlaygroundCombat('me');
    const listener = vi.fn();
    combat.subscribe(listener);
    combat.receive({ t: 'playground-xp', conversationId: 'conv', xp: 7 });
    combat.receive(hit());
    expect(combat.getVitals()).toMatchObject({ xp: 7, health: 19 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
