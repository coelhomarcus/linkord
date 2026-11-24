import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, characterFor } from '@/features/playground/characters';
import { spawnPoint } from '@/features/playground/playgroundWorld';

describe('playground world', () => {
  it('always gives an account the same character, and spreads accounts over all of them', () => {
    expect(characterFor('user-1')).toBe(characterFor('user-1'));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => characterFor(`user-${i}`)));
    expect(seen.size).toBe(CHARACTER_IDS.length);
  });

  it('spawns a connection at the same spot every time, on the ground, facing the screen', () => {
    expect(spawnPoint('conn-a')).toEqual(spawnPoint('conn-a'));
    expect(spawnPoint('conn-a').y).toBe(0);
    expect(spawnPoint('conn-a').yaw).toBe(Math.PI);
    expect(spawnPoint('conn-a')).not.toEqual(spawnPoint('conn-b'));
  });
});
