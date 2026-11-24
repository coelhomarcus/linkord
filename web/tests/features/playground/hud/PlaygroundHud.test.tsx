import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaygroundHud } from '@/features/playground/hud/PlaygroundHud';
import { guiScale } from '@/features/playground/hud/gui';
import { createInventory } from '@game/inventory';
import type { Vitals } from '@/features/playground/playgroundCombat';

const vitals = (health: number, xp = 0): Vitals => ({ health, previousHealth: 20, lastChange: 'hurt', hurts: 1, heals: 0, killerId: null, xp, xpKnown: true });

describe('guiScale', () => {
  it('is as large as it can be while 320 × 240 of it still fit, up to 4', () => {
    expect(guiScale(390, 700)).toBe(1);
    expect(guiScale(800, 600)).toBe(2);
    expect(guiScale(1920, 1080)).toBe(4);
    expect(guiScale(1280, 720)).toBe(3);
  });
});

describe('PlaygroundHud', () => {
  it('says the health in hearts and lists the hotbar\'s slots, the selected one pressed', () => {
    const inventory = { ...createInventory(), selected: 1 };
    const slots = [...inventory.slots];
    slots[1] = { item: 'dirt', count: 37 };
    const onSelect = vi.fn();
    render(<PlaygroundHud vitals={vitals(7)} inventory={{ ...inventory, slots }} scale={2} onSelect={onSelect} />);
    expect(screen.getByRole('meter', { name: 'Vida' }).getAttribute('aria-valuetext')).toBe('3.5 corações');
    const dirt = screen.getByRole('button', { name: 'Terra (37)' });
    expect(dirt.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: 'Espaço vazio' })).toHaveLength(8);
    fireEvent.click(screen.getAllByRole('button', { name: 'Espaço vazio' })[0]!);
    expect(onSelect).toHaveBeenCalledWith(0);
    // the held item's name shows above the hotbar
    expect(screen.getByText('Terra')).toBeTruthy();
  });

  it('shows the level and how full the experience bar is', () => {
    render(<PlaygroundHud vitals={vitals(20, 7 + 4)} inventory={createInventory()} scale={1} onSelect={() => {}} />);
    const bar = screen.getByRole('meter', { name: 'Nível 1' });
    expect(bar.getAttribute('aria-valuenow')).toBe('44');
    expect(screen.getByText('1')).toBeTruthy();
  });
});
