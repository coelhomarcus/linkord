import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';
import { useMemberListOpen } from '@/features/servers/memberListPreference';

const CHANNEL = '/app/channels/s1/c1';
const OTHER_CHANNEL = '/app/channels/s1/c2';

function renderMemberList(wide: boolean, pathname = CHANNEL) {
  return renderHook(({ wide, pathname }) => useMemberListOpen(wide, pathname), { initialProps: { wide, pathname } });
}

describe('useMemberListOpen', () => {
  afterEach(() => localStorage.clear());

  it('starts open beside the chat on a wide screen and closed as an overlay below it', () => {
    expect(renderMemberList(true).result.current[0]).toBe(true);
    expect(renderMemberList(false).result.current[0]).toBe(false);
  });

  it('keeps the column closed after a reload when the user closes it', () => {
    const first = renderMemberList(true);
    act(() => first.result.current[1](false));
    expect(renderMemberList(true).result.current[0]).toBe(false);
  });

  it('remembers each layout on its own: closing the overlay leaves the column open', () => {
    const { result, rerender } = renderMemberList(false);
    act(() => result.current[1](true));
    act(() => result.current[1](false));
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.memberListOpen)).toBeNull();

    rerender({ wide: true, pathname: CHANNEL });
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));

    rerender({ wide: false, pathname: CHANNEL });
    act(() => result.current[1](true));
    rerender({ wide: true, pathname: CHANNEL });
    expect(result.current[0]).toBe(false);
    rerender({ wide: false, pathname: CHANNEL });
    expect(result.current[0]).toBe(true);
  });

  it('closes the overlay when the page changes, but not the column', () => {
    const { result, rerender } = renderMemberList(false);
    act(() => result.current[1](true));
    rerender({ wide: false, pathname: OTHER_CHANNEL });
    expect(result.current[0]).toBe(false);

    rerender({ wide: true, pathname: OTHER_CHANNEL });
    expect(result.current[0]).toBe(true);
    rerender({ wide: true, pathname: CHANNEL });
    expect(result.current[0]).toBe(true);
  });

  it('reopens an overlay left open on the same page after a reload', () => {
    const first = renderMemberList(false);
    act(() => first.result.current[1](true));
    expect(renderMemberList(false).result.current[0]).toBe(true);
  });
});
