import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCallMoveGate } from '@/features/calls/useCallMoveGate';

function setup(heldElsewhere: boolean) {
  const held = { value: heldElsewhere };
  const { result } = renderHook(() => useCallMoveGate(() => held.value));
  return { result, held };
}

describe('useCallMoveGate', () => {
  it('sends a request at once when the account holds no call elsewhere', () => {
    const { result } = setup(false);
    const attempt = vi.fn();
    act(() => result.current.request({ send: attempt }));
    expect(attempt).toHaveBeenCalledWith(false);
    expect(result.current.open).toBe(false);
  });

  it('asks first when the account is in a call elsewhere, and replaces it once confirmed', () => {
    const { result } = setup(true);
    const attempt = vi.fn();
    act(() => result.current.request({ send: attempt }));
    expect(attempt).not.toHaveBeenCalled();
    expect(result.current.open).toBe(true);

    act(() => result.current.confirm());
    expect(attempt).toHaveBeenCalledWith(true);
    expect(result.current.open).toBe(false);
  });

  it('sends nothing when the person keeps the call where it is, and says the request was dropped', () => {
    const { result } = setup(true);
    const attempt = vi.fn();
    const drop = vi.fn();
    act(() => result.current.request({ send: attempt, drop }));
    act(() => result.current.cancel());
    act(() => result.current.confirm());
    expect(attempt).not.toHaveBeenCalled();
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it('a newer request while one waits drops the older one', () => {
    const { result } = setup(true);
    const older = { send: vi.fn(), drop: vi.fn() };
    const newer = { send: vi.fn(), drop: vi.fn() };
    act(() => result.current.request(older));
    act(() => result.current.request(newer));
    act(() => result.current.confirm());
    expect(older.drop).toHaveBeenCalled();
    expect(older.send).not.toHaveBeenCalled();
    expect(newer.send).toHaveBeenCalledWith(true);
  });

  it('a request the server refused because another tab got there first is put up for confirmation', () => {
    const { result } = setup(false);
    const attempt = vi.fn();
    act(() => result.current.request({ send: attempt }));
    let asked = false;
    act(() => { asked = result.current.onRefused(); });
    expect(asked).toBe(true);
    expect(result.current.open).toBe(true);

    act(() => result.current.confirm());
    expect(attempt).toHaveBeenLastCalledWith(true);
  });

  it('a refusal with nothing sent is not one to ask about', () => {
    const { result } = setup(false);
    let asked = true;
    act(() => { asked = result.current.onRefused(); });
    expect(asked).toBe(false);
  });
});
