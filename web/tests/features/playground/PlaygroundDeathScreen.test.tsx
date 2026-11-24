import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlaygroundDeathScreen } from '@/features/playground/PlaygroundDeathScreen';

describe('PlaygroundDeathScreen', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('says who did it and lets you respawn after a second', () => {
    vi.useFakeTimers();
    const onRespawn = vi.fn();
    render(<PlaygroundDeathScreen killerName="Bia" onRespawn={onRespawn} />);
    expect(screen.getByRole('alertdialog', { name: 'Você morreu!' })).toBeTruthy();
    expect(screen.getByText('Bia te derrotou')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Renascer' });
    fireEvent.click(button);
    expect(onRespawn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.click(button);
    expect(onRespawn).toHaveBeenCalledTimes(1);
  });

  it('leaves out who did it when it is not known', () => {
    render(<PlaygroundDeathScreen killerName={null} onRespawn={() => {}} />);
    expect(screen.queryByText(/te derrotou/)).toBeNull();
  });
});

describe('PlaygroundDeathScreen causes', () => {
  it('says what killed you when no one did', () => {
    const { rerender } = render(<PlaygroundDeathScreen killerName={null} cause="fall" onRespawn={() => {}} />);
    expect(screen.getByText('Você caiu de um lugar alto')).toBeTruthy();
    rerender(<PlaygroundDeathScreen killerName={null} cause="drown" onRespawn={() => {}} />);
    expect(screen.getByText('Você se afogou')).toBeTruthy();
    rerender(<PlaygroundDeathScreen killerName={null} cause="starve" onRespawn={() => {}} />);
    expect(screen.getByText('Você morreu de fome')).toBeTruthy();
  });
});
