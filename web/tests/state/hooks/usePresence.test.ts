import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePresence } from '@/state/hooks/usePresence';
import type { PublicUser } from '@/shared/types/protocol';

const peer: PublicUser = {
  id: 'peer', username: 'peer', displayName: 'Peer', avatar: '', avatarColor: 'blurple',
  banner: '', bio: '', profileLinks: [], role: 'user', lastSeenAt: null,
};

describe('usePresence', () => {
  it('user-offline drops the id and writes lastSeenAt onto the cached profile', () => {
    const { result } = renderHook(() => usePresence());
    act(() => {
      result.current.setInitial([peer], ['peer'], ['peer']);
    });
    expect(result.current.onlineUserIds.has('peer')).toBe(true);

    act(() => {
      result.current.onUserOffline({ t: 'user-offline', userId: 'peer', lastSeenAt: '2026-10-24T17:32:00.000Z' });
    });

    expect(result.current.onlineUserIds.has('peer')).toBe(false);
    expect(result.current.allUsers.get('peer')?.lastSeenAt).toBe('2026-10-24T17:32:00.000Z');
  });
});
