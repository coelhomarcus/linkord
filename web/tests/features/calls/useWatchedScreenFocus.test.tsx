import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useWatchedScreenFocus } from '@/features/calls/useWatchedScreenFocus';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { initialRoomState } from '@/state/roomReducer';
import type { RoomState } from '@/state/roomReducer';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Participant } from '@/shared/types/protocol';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

const screenTile = (participantId: string): TileDescriptor => ({ key: `${participantId}:screen`, participantId, kind: 'screen', loading: true, paused: false });
const avatarTile = (participantId: string): TileDescriptor => ({ key: `${participantId}:participant`, participantId, kind: 'avatar', loading: false, paused: false });

function bea(over: Partial<Participant> = {}): Participant {
  return {
    id: 'p-bea', userId: 'u-bea', name: 'bea', displayName: 'Bea', avatar: '', avatarPoster: '', avatarColor: 'green', banner: '', bannerPoster: '', bio: '',
    profileLinks: [], role: 'user', deafened: false, callConversationId: 'v1', micActivated: true, micMuted: false,
    cameraOn: false, sharing: true, speaking: false, ...over,
  };
}

const target = { conversationId: 'v1', participantId: 'p-bea' };

/** The hook as the stage runs it, over a room whose value a test replaces as the call moves on. */
function setup(initial: { active: string | null; state: Partial<RoomState>; descriptors: TileDescriptor[] }) {
  const dispatch = vi.fn();
  let room: RoomContextValue = value(initial.active, initial.state);
  function value(active: string | null, state: Partial<RoomState>): RoomContextValue {
    return createFakeRoomContextValue({ dispatch, activeCallConversationId: active, state: { ...initialRoomState, ...state } });
  }
  const wrapper = ({ children }: { children: ReactNode }) => <RoomStoreProvider value={room}>{children}</RoomStoreProvider>;
  const hook = renderHook(({ descriptors }) => useWatchedScreenFocus(descriptors), { wrapper, initialProps: { descriptors: initial.descriptors } });
  return {
    dispatch,
    update(next: { active: string | null; state: Partial<RoomState>; descriptors: TileDescriptor[] }) {
      room = value(next.active, next.state);
      hook.rerender({ descriptors: next.descriptors });
    },
  };
}

describe('useWatchedScreenFocus', () => {
  it('waits while the call asked for is not this tab\'s call yet (joining, or moving from another call)', () => {
    const { dispatch } = setup({ active: 'v2', state: { pendingScreenFocus: target, participants: new Map([['p-bea', bea()]]) }, descriptors: [] });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('waits for her share\'s tile once joined, then focuses it as a manual choice and forgets the request', () => {
    const state = { pendingScreenFocus: target, participants: new Map([['p-bea', bea()]]) };
    const { dispatch, update } = setup({ active: 'v1', state, descriptors: [avatarTile('p-bea')] });
    expect(dispatch).not.toHaveBeenCalled();

    update({ active: 'v1', state, descriptors: [avatarTile('p-bea'), screenTile('p-bea')] });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-bea:screen', origin: 'manual' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'DROP_PENDING_SCREEN_FOCUS', target });
  });

  it('focuses at once when the tile is already there (in the call already)', () => {
    const { dispatch } = setup({
      active: 'v1', state: { pendingScreenFocus: target, participants: new Map([['p-bea', bea()]]) },
      descriptors: [screenTile('p-other'), screenTile('p-bea')],
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-bea:screen', origin: 'manual' });
  });

  it('a share that ended before it arrived leaves the call unfocused, the request dropped', () => {
    const { dispatch } = setup({
      active: 'v1', state: { pendingScreenFocus: target, participants: new Map([['p-bea', bea({ sharing: false })]]) },
      descriptors: [avatarTile('p-bea')],
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'DROP_PENDING_SCREEN_FOCUS', target });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_FOCUSED' }));
  });

  it('someone who left the call, or moved to another, is not waited for', () => {
    const { dispatch, update } = setup({
      active: 'v1', state: { pendingScreenFocus: target, participants: new Map([['p-bea', bea({ callConversationId: 'v2' })]]) }, descriptors: [],
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'DROP_PENDING_SCREEN_FOCUS', target });
    dispatch.mockClear();
    update({ active: 'v1', state: { pendingScreenFocus: target, participants: new Map() }, descriptors: [] });
    expect(dispatch).toHaveBeenCalledWith({ type: 'DROP_PENDING_SCREEN_FOCUS', target });
  });

  it('your own share is read from your own state', () => {
    const own = { conversationId: 'v1', participantId: 'p-me' };
    const me = { ...initialRoomState.me, id: 'p-me', sharing: true };
    const { dispatch, update } = setup({ active: 'v1', state: { pendingScreenFocus: own, me }, descriptors: [] });
    expect(dispatch).not.toHaveBeenCalled();
    update({ active: 'v1', state: { pendingScreenFocus: own, me }, descriptors: [screenTile('p-me')] });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-me:screen', origin: 'manual' });
  });

  it('does nothing without a request', () => {
    const { dispatch } = setup({ active: 'v1', state: {}, descriptors: [screenTile('p-bea')] });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
