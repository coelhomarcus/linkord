import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { forwardRef } from 'react';
import { initialRoomState } from '@/state/roomReducer';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { Stage } from '@/features/calls/Stage';

vi.mock('@/features/calls/CallControlBar', () => ({
  // A real forwardRef — Stage measures this element's height, so the mock
  // has to actually accept the ref, not just ignore it like a plain div would.
  CallControlBar: forwardRef<HTMLDivElement>(function CallControlBar(_props, ref) {
    return <div ref={ref} data-testid="control-bar" />;
  }),
}));

// one avatar tile per id, so a test can say who is in the call through allIds alone
vi.mock('@/features/calls/useCallTiles', () => ({
  useCallTiles: (ids: string[]) => ids.map((id) => ({ key: `${id}:participant`, participantId: id, kind: 'avatar', loading: false, paused: false })),
}));
vi.mock('@/features/calls/CallInviteTile', () => ({
  CallInviteTile: ({ conversationId }: { conversationId: string }) => <div data-testid="invite-tile" data-conversation-id={conversationId} />,
}));

const tileGridSpy = vi.fn();
vi.mock('@/features/calls/TileGrid', () => ({
  TileGrid: (props: { onCapacityChange?: (meetsMinimum: boolean, key: string | null) => void }) => {
    tileGridSpy(props);
    return <div data-testid="tile-grid" />;
  },
}));

function lastOnCapacityChange(): (meetsMinimum: boolean, key: string | null) => void {
  const call = tileGridSpy.mock.calls.at(-1);
  return call![0].onCapacityChange!;
}

function renderStage(props: { allIds: string[] }, overrides: Partial<RoomContextValue> = {}) {
  return render(
    <RoomStoreProvider value={createFakeRoomContextValue(overrides)}>
      <SidebarProvider>
        <Stage {...props} onBack={() => {}} />
      </SidebarProvider>
    </RoomStoreProvider>
  );
}

describe('Stage — composition and integration with fullscreen', () => {
  it('attaches callStageRef to its own root element (fullscreen target)', () => {
    const callStageRef = { current: null as HTMLElement | null };
    const { container } = renderStage({ allIds: [] }, { callStageRef });
    expect(callStageRef.current).toBe(container.querySelector('[data-stage]'));
  });

  it('renders CallControlBar inside itself', () => {
    renderStage({ allIds: [] });
    expect(document.querySelector('[data-testid="control-bar"]')).toBeInTheDocument();
  });

  it('keeps the control bar however long nobody touches anything', () => {
    vi.useFakeTimers();
    try {
      renderStage({ allIds: [] });
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(document.querySelector('[data-testid="control-bar"]')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Stage — dynamic space reservation for the bar (no fixed pb-32)', () => {
  it('measures the real height of the bar (+ banners) and reserves exactly height + spacing', () => {
    const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 60 } as DOMRect);
    try {
      renderStage({ allIds: [] });
      const stage = document.querySelector('[data-stage]') as HTMLElement;
      expect(stage.style.paddingBottom).toBe('72px');
    } finally {
      getRect.mockRestore();
    }
  });
});

describe("Stage — capacity fallback (TileGrid can't fit everyone -> automatic focus)", () => {
  it('with no one focused, insufficient capacity triggers SET_FOCUSED with origin "capacity"', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [] }, { dispatch, state: { ...initialRoomState, focusedId: null, focusOrigin: null } });
    lastOnCapacityChange()(false, 'p-2:avatar');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:avatar', origin: 'capacity' });
  });

  it('when capacity fits again, undoes ONLY a focus that it itself caused', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [] }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:avatar', focusOrigin: 'capacity' },
    });
    lastOnCapacityChange()(true, null);
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: null, origin: 'capacity' });
  });

  it('never overwrites a MANUAL focus, neither to focus nor to unfocus', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [] }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:avatar', focusOrigin: 'manual' },
    });
    lastOnCapacityChange()(false, 'p-3:avatar');
    lastOnCapacityChange()(true, null);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not touch an automatic focus caused by screen share (origin "automatic"), only what it itself caused', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [] }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:screen', focusOrigin: 'automatic' },
    });
    lastOnCapacityChange()(true, null);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('already with something focused (any origin), does not focus again just due to lack of capacity', () => {
    const dispatch = vi.fn();
    renderStage({ allIds: [] }, {
      dispatch, state: { ...initialRoomState, focusedId: 'p-2:screen', focusOrigin: 'automatic' },
    });
    lastOnCapacityChange()(false, 'p-3:avatar');
    expect(dispatch).not.toHaveBeenCalled();
  });

  describe('invite tile', () => {
    const conversation = (type: 'voice' | 'direct') => ({
      id: 'c1', type, title: 'Squad', serverId: type === 'voice' ? 's1' : null, memberIds: ['me', 'ana'],
      lastMessageAt: null, createdAt: 1, updatedAt: 1,
    });
    const lastExtraTile = () => tileGridSpy.mock.calls.at(-1)![0].extraTile as React.ReactElement<{ conversationId: string }> | undefined;

    it('fills the empty seat while you are alone in a group call', () => {
      renderStage({ allIds: ['me'] }, { activeCallConversationId: 'c1', conversations: [conversation('voice')] });
      expect(lastExtraTile()?.props.conversationId).toBe('c1');
    });

    it('goes away once someone else is in the call', () => {
      renderStage({ allIds: ['me', 'ana'] }, { activeCallConversationId: 'c1', conversations: [conversation('voice')] });
      expect(lastExtraTile()).toBeUndefined();
    });

    it('a private call has nobody else to invite', () => {
      renderStage({ allIds: ['me'] }, { activeCallConversationId: 'c1', conversations: [conversation('direct')] });
      expect(lastExtraTile()).toBeUndefined();
    });
  });
});
