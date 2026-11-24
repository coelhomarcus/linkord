import { describe, expect, it } from 'vitest';
import { BLOCK } from '@game/blocks';
import { Footsteps, materialOf, SOUNDS } from '@/features/playground/engine/sounds';

describe('playground sounds', () => {
  it('hears each block as what it is made of', () => {
    expect(materialOf(BLOCK.grass)).toBe('grass');
    expect(materialOf(BLOCK.dirt)).toBe('gravel');
    expect(materialOf(BLOCK.planks)).toBe('wood');
    expect(materialOf(BLOCK.chest)).toBe('wood');
    expect(materialOf(BLOCK.redWool)).toBe('cloth');
    expect(materialOf(BLOCK.redConcrete)).toBe('stone');
    expect(materialOf(BLOCK.diamondOre)).toBe('stone');
    expect(materialOf(BLOCK.air)).toBeNull();
    expect(materialOf(BLOCK.water)).toBeNull();
  });

  it('has a recording for every named sound', () => {
    for (const [name, sound] of Object.entries(SOUNDS)) expect(sound.urls.length, name).toBeGreaterThan(0);
  });

  it('steps once every 1/0.6 blocks walked, as the game does', () => {
    const steps = new Footsteps();
    let heard = 0;
    // a little over 10 blocks, in tenths
    for (let i = 0; i < 101; i++) if (steps.step(0.1)) heard++;
    expect(heard).toBe(6);
  });
});
