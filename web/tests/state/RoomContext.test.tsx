import { describe, expect, it } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useOptionalRoomSelector, useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

function counter() {
  const renders: Record<string, number> = {};
  const count = (name: string) => { renders[name] = (renders[name] ?? 0) + 1; };
  return { renders, count };
}

describe('room store', () => {
  it('re-renders a reader only when a field it named changes', () => {
    const { renders, count } = counter();
    function ReadsVolume() {
      const { notifyVolume } = useRoom('notifyVolume');
      count('volume');
      return <span>{notifyVolume}</span>;
    }
    function ReadsMe() {
      const { me } = useRoomState('me');
      count('me');
      return <span>{me.name}</span>;
    }
    function ReadsParticipants() {
      const { participants } = useRoomState('participants');
      count('participants');
      return <span>{participants.size}</span>;
    }
    const tree = (
      <>
        <ReadsVolume />
        <ReadsMe />
        <ReadsParticipants />
      </>
    );
    let value = createFakeRoomContextValue();
    const view = render(<RoomStoreProvider value={value}>{tree}</RoomStoreProvider>);
    expect(renders).toEqual({ volume: 1, me: 1, participants: 1 });

    value = { ...value, state: { ...value.state, participants: new Map(value.state.participants) } };
    view.rerender(<RoomStoreProvider value={value}>{tree}</RoomStoreProvider>);
    expect(renders).toEqual({ volume: 1, me: 1, participants: 2 });

    value = { ...value, notifyVolume: 0.25 };
    view.rerender(<RoomStoreProvider value={value}>{tree}</RoomStoreProvider>);
    expect(renders).toEqual({ volume: 2, me: 1, participants: 2 });
    expect(view.container.textContent).toContain('0.25');
  });

  it('keeps a derived selection while it compares equal', () => {
    const { renders, count } = counter();
    function ServerCount() {
      const total = useRoomSelector((room) => room.servers.length);
      count('servers');
      return <span>{total}</span>;
    }
    const reader = <ServerCount />;
    let value = createFakeRoomContextValue({ servers: [] });
    const view = render(<RoomStoreProvider value={value}>{reader}</RoomStoreProvider>);
    value = { ...value, servers: [] };
    view.rerender(<RoomStoreProvider value={value}>{reader}</RoomStoreProvider>);
    expect(renders.servers).toBe(1);
  });

  it('reads with a selector that depends on props', () => {
    const value = createFakeRoomContextValue({ unreadByConversation: new Map([['a', 1], ['b', 7]]) });
    const wrapper = ({ children }: { children: ReactNode }) => <RoomStoreProvider value={value}>{children}</RoomStoreProvider>;
    const { result, rerender } = renderHook(({ id }) => useRoomSelector((room) => room.unreadByConversation.get(id)), { wrapper, initialProps: { id: 'a' } });
    expect(result.current).toBe(1);
    rerender({ id: 'b' });
    expect(result.current).toBe(7);
  });

  it('reads undefined outside the provider only through the optional reader', () => {
    const { result } = renderHook(() => useOptionalRoomSelector((room: RoomContextValue) => room.servers));
    expect(result.current).toBeUndefined();
    expect(() => renderHook(() => useRoom('servers'))).toThrow(/outside <RoomProvider>/);
  });
});
