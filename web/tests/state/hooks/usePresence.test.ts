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

  it("a profile change carries the new avatar's still frame into the cache", () => {
    const { result } = renderHook(() => usePresence());
    act(() => result.current.setInitial([peer], [], []));
    act(() => result.current.onParticipantUpdated({
      t: 'participant-updated',
      participant: { userId: 'peer', avatar: '/uploads/a.gif', avatarPoster: '/uploads/a.webp', avatarColor: 'blurple', displayName: 'Peer', banner: '', bio: '', profileLinks: [], role: 'user' } as never,
    }));
    expect(result.current.allUsers.get('peer')).toMatchObject({ avatar: '/uploads/a.gif', avatarPoster: '/uploads/a.webp' });
  });

  it('keeps the status of online people and forgets it when they go offline', () => {
    const { result } = renderHook(() => usePresence());
    act(() => result.current.setInitial([peer], ['peer'], ['peer'], { peer: { status: 'dnd', customStatus: null } }));
    expect(result.current.presenceByUser.get('peer')?.status).toBe('dnd');

    const custom = { emoji: '🎮', text: 'jogando', expiresAt: null };
    act(() => result.current.onPresenceStatus({ t: 'presence-status', userId: 'peer', status: 'idle', customStatus: custom }));
    expect(result.current.presenceByUser.get('peer')).toEqual({ status: 'idle', customStatus: custom });

    act(() => result.current.onUserOffline({ t: 'user-offline', userId: 'peer' }));
    expect(result.current.presenceByUser.has('peer')).toBe(false);
  });

  it('a plain "online" without a custom status needs no entry', () => {
    const { result } = renderHook(() => usePresence());
    act(() => result.current.setInitial([peer], ['peer'], ['peer'], { peer: { status: 'dnd', customStatus: null } }));
    act(() => result.current.onPresenceStatus({ t: 'presence-status', userId: 'peer', status: 'online', customStatus: null }));
    expect(result.current.presenceByUser.has('peer')).toBe(false);
  });

  it('a snapshot from a server without statuses reads as everyone plain online', () => {
    const { result } = renderHook(() => usePresence());
    act(() => result.current.setInitial([peer], ['peer'], ['peer'], { peer: { status: 'dnd', customStatus: null } }));
    act(() => result.current.setInitial([peer], ['peer'], ['peer']));
    expect(result.current.presenceByUser.size).toBe(0);
  });
});
