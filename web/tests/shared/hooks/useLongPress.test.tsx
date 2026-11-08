import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTouchContextMenu, LONG_PRESS_DELAY_MS, useLongPress } from '@/shared/hooks/useLongPress';
import type { LongPressOptions } from '@/shared/hooks/useLongPress';

function Pressable({ options, onClick }: { options: LongPressOptions; onClick?: () => void }) {
  const press = useLongPress(options);
  return (
    <div data-testid="surface" {...press}>
      <button type="button" onClick={onClick}>row</button>
      <a href="#x">link</a>
    </div>
  );
}

function setup(overrides: Partial<LongPressOptions> = {}) {
  const onLongPress = vi.fn();
  const onStart = vi.fn();
  const onEnd = vi.fn();
  const onClick = vi.fn();
  render(<Pressable options={{ onLongPress, onStart, onEnd, ...overrides }} onClick={onClick} />);
  return { onLongPress, onStart, onEnd, onClick, button: screen.getByRole('button', { name: 'row' }) };
}

const touch = (pointerId = 1, x = 20, y = 20) => ({ pointerType: 'touch', pointerId, button: 0, clientX: x, clientY: y });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('useLongPress', () => {
  it('fires once the delay has passed with the finger still down, where it went down', () => {
    const { onLongPress, onStart, button } = setup();
    fireEvent.pointerDown(button, touch(1, 30, 40));
    expect(onStart).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS - 1); });
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onLongPress).toHaveBeenCalledWith(expect.objectContaining({ target: button, x: 30, y: 40, pointerType: 'touch' }));
  });

  it('a release before the delay is a tap, and the tap still clicks', () => {
    const { onLongPress, onEnd, onClick, button } = setup();
    fireEvent.pointerDown(button, touch());
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(button, touch());
    fireEvent.click(button);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(expect.anything(), 'tap');
    expect(onClick).toHaveBeenCalled();
  });

  it('after it fires, the release ends it and the click that follows is swallowed', () => {
    const { onEnd, onClick, button } = setup();
    fireEvent.pointerDown(button, touch());
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    fireEvent.pointerUp(button, touch());
    fireEvent.click(button);
    expect(onEnd).toHaveBeenCalledWith(expect.anything(), 'release');
    expect(onClick).not.toHaveBeenCalled();
    // only that one click: the next tap is a tap
    fireEvent.pointerDown(button, touch());
    fireEvent.pointerUp(button, touch());
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a finger that drifts within the tolerance still fires; past it, the press is a scroll', () => {
    const first = setup();
    fireEvent.pointerDown(first.button, touch(1, 20, 20));
    fireEvent.pointerMove(first.button, touch(1, 26, 26));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(first.onLongPress).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(first.button, touch());
    first.onLongPress.mockClear();

    fireEvent.pointerDown(first.button, touch(2, 20, 20));
    fireEvent.pointerMove(first.button, touch(2, 20, 35));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(first.onLongPress).not.toHaveBeenCalled();
    expect(first.onEnd).toHaveBeenLastCalledWith(expect.anything(), 'cancel');
  });

  it('the browser taking the pointer over (pointercancel) ends the press', () => {
    const { onLongPress, onEnd, button } = setup();
    fireEvent.pointerDown(button, touch());
    fireEvent.pointerCancel(button, touch());
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(expect.anything(), 'cancel');
  });

  it('something scrolling under a still finger ends the press, unless told not to', () => {
    const scrolled = setup();
    fireEvent.pointerDown(scrolled.button, touch());
    fireEvent.scroll(window);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(scrolled.onLongPress).not.toHaveBeenCalled();
  });

  it('keeps going through a scroll with cancelOnScroll off', () => {
    const { onLongPress, button } = setup({ cancelOnScroll: false });
    fireEvent.pointerDown(button, touch());
    fireEvent.scroll(window);
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).toHaveBeenCalled();
  });

  it('a second finger makes it a pinch, not a press', () => {
    const { onLongPress, onEnd, button } = setup();
    fireEvent.pointerDown(button, touch(1));
    fireEvent.pointerDown(document.body, touch(2));
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith(expect.anything(), 'cancel');
  });

  it('leaves the mouse to right-click unless asked, and other buttons always', () => {
    const { onLongPress, button } = setup();
    fireEvent.pointerDown(button, { pointerType: 'mouse', pointerId: 1, button: 0 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("with pointerTypes 'all' a mouse press counts too, but not with the right button", () => {
    const { onLongPress, button } = setup({ pointerTypes: 'all' });
    fireEvent.pointerDown(button, { pointerType: 'mouse', pointerId: 1, button: 2 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).not.toHaveBeenCalled();
    fireEvent.pointerUp(button, { pointerType: 'mouse', pointerId: 1, button: 2 });
    fireEvent.pointerDown(button, { pointerType: 'mouse', pointerId: 1, button: 0 });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onLongPress).toHaveBeenCalled();
  });

  it('shouldStart can leave a pointer to the browser', () => {
    const { onLongPress, onStart } = setup({ shouldStart: (event) => !(event.target as Element).closest('a') });
    fireEvent.pointerDown(screen.getByRole('link'), touch());
    act(() => { vi.advanceTimersByTime(LONG_PRESS_DELAY_MS); });
    expect(onStart).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('a custom delay and an infinite tolerance (the composer mic)', () => {
    const { onLongPress, button } = setup({ delay: 300, tolerance: Infinity });
    fireEvent.pointerDown(button, touch(1, 0, 0));
    fireEvent.pointerMove(button, touch(1, 400, 400));
    act(() => { vi.advanceTimersByTime(300); });
    expect(onLongPress).toHaveBeenCalled();
  });
});

describe('isTouchContextMenu', () => {
  it('tells a finger from a mouse or the keyboard menu key', () => {
    expect(isTouchContextMenu(new PointerEvent('contextmenu', { pointerType: 'touch' }))).toBe(true);
    expect(isTouchContextMenu(new PointerEvent('contextmenu', { pointerType: 'mouse' }))).toBe(false);
    expect(isTouchContextMenu(new MouseEvent('contextmenu'))).toBe(false);
  });
});
