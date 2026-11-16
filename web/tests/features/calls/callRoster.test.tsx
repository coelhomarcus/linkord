import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { sameRoster, useCallRoster } from '@/features/calls/callRoster';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';
import type { RoomContextValue } from '@/state/RoomContext';
import type { Participant } from '@/shared/types/protocol';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

function participant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-1', userId: 'u-1', name: 'ana', displayName: 'Ana', avatar: '', avatarPoster: '', avatarColor: 'blue',
    banner: '', bannerPoster: '', bio: '', profileLinks: ['https://example.com'], role: 'user', deafened: false,
    callConversationId: 'voice-1', micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

const roster = (...list: Participant[]) => new Map(list.map((p) => [p.id, p]));

describe('sameRoster', () => {
  it('ignores media flags, and arrays that arrive new but equal', () => {
    const before = roster(participant());
    const after = roster(participant({ speaking: true, micMuted: true, cameraOn: true, profileLinks: ['https://example.com'] }));
    expect(sameRoster(before, after)).toBe(true);
  });

  it('notices joins, leaves, call moves and profile changes', () => {
    const base = roster(participant());
    expect(sameRoster(base, roster(participant(), participant({ id: 'p-2', userId: 'u-2' })))).toBe(false);
    expect(sameRoster(base, roster())).toBe(false);
    expect(sameRoster(base, roster(participant({ callConversationId: 'voice-2' })))).toBe(false);
    expect(sameRoster(base, roster(participant({ displayName: 'Ana C.' })))).toBe(false);
    expect(sameRoster(base, roster(participant({ profileLinks: [] })))).toBe(false);
  });
});

describe('useCallRoster', () => {
  it('keeps its identity while someone only starts speaking', () => {
    let value = createFakeRoomContextValue();
    value = { ...value, state: { ...value.state, participants: roster(participant()) } };
    const withParticipants = (list: Participant[]): RoomContextValue => ({ ...value, state: { ...value.state, participants: roster(...list) } });
    let current = value;
    const wrapper = ({ children }: { children: ReactNode }) => <RoomStoreProvider value={current}>{children}</RoomStoreProvider>;
    const { result, rerender } = renderHook(() => useCallRoster(), { wrapper });
    const first = result.current;

    current = withParticipants([participant({ speaking: true })]);
    rerender();
    expect(result.current).toBe(first);

    current = withParticipants([participant({ speaking: true, callConversationId: 'voice-2' })]);
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current.get('p-1')?.callConversationId).toBe('voice-2');
  });
});
