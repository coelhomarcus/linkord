import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHorizontalSwipe } from '@/shared/hooks/useHorizontalSwipe';
import { SWIPE } from '@/shared/lib/swipe';

function Surface({
  onEnd,
  onMove,
  shouldStart,
  commitPx,
}: {
  onEnd: (dx: number, committed: boolean) => void;
  onMove?: (dx: number) => void;
  shouldStart?: () => boolean;
  commitPx?: number;
}) {
  const swipe = useHorizontalSwipe({
    enabled: true,
    direction: 'right',
    commitPx,
    shouldStart,
    onMove,
    onEnd,
  });
  return <div data-testid="surface" {...swipe}>row</div>;
}

const touch = (pointerId: number, x: number, y: number) => ({
  pointerType: 'touch', pointerId, button: 0, clientX: x, clientY: y,
});

function swipe(el: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(el, touch(1, from.x, from.y));
  fireEvent.pointerMove(el, touch(1, to.x, to.y));
  fireEvent.pointerUp(el, touch(1, to.x, to.y));
}

describe('useHorizontalSwipe', () => {
  it('commits a right swipe once it passes the threshold', () => {
    const onEnd = vi.fn();
    render(<Surface onEnd={onEnd} commitPx={SWIPE.replyCommitPx} />);
    swipe(screen.getByTestId('surface'), { x: 40, y: 40 }, { x: 40 + SWIPE.replyCommitPx, y: 42 });
    expect(onEnd).toHaveBeenCalledWith(SWIPE.replyCommitPx, true);
  });

  it('releases short of the threshold without committing', () => {
    const onEnd = vi.fn();
    render(<Surface onEnd={onEnd} commitPx={SWIPE.replyCommitPx} />);
    swipe(screen.getByTestId('surface'), { x: 40, y: 40 }, { x: 40 + SWIPE.lockPx + 1, y: 40 });
    expect(onEnd).toHaveBeenCalledWith(SWIPE.lockPx + 1, false);
  });

  it('lets a vertical move win: the swipe never claims, so a scroll can proceed', () => {
    const onEnd = vi.fn();
    const onMove = vi.fn();
    render(<Surface onEnd={onEnd} onMove={onMove} />);
    const el = screen.getByTestId('surface');
    fireEvent.pointerDown(el, touch(1, 40, 40));
    fireEvent.pointerMove(el, touch(1, 44, 40 + SWIPE.lockPx + 8));
    fireEvent.pointerUp(el, touch(1, 44, 80));
    expect(onEnd).not.toHaveBeenCalled();
    expect(onMove.mock.calls.every(([dx]) => dx === 0)).toBe(true);
  });

  it('a pointercancel before the claim is a scroll, not a swipe', () => {
    const onEnd = vi.fn();
    render(<Surface onEnd={onEnd} />);
    const el = screen.getByTestId('surface');
    fireEvent.pointerDown(el, touch(1, 40, 40));
    fireEvent.pointerCancel(el, touch(1, 40, 40));
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('ignores a mouse', () => {
    const onEnd = vi.fn();
    render(<Surface onEnd={onEnd} />);
    const el = screen.getByTestId('surface');
    fireEvent.pointerDown(el, { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(el, { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 120, clientY: 40 });
    fireEvent.pointerUp(el, { pointerType: 'mouse', pointerId: 1, button: 0, clientX: 120, clientY: 40 });
    expect(onEnd).not.toHaveBeenCalled();
  });
});
