import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppBadgeSync } from '@/features/notifications/AppBadgeSync';
import { clearAppBadge, refreshAppBadge } from '@/features/notifications/appBadge';
import { useRoom } from '@/state/RoomContext';
import { useUnreadNotifications } from '@/features/notifications/useUnreadNotifications';

vi.mock('@/state/RoomContext', () => ({ useRoom: vi.fn() }));
vi.mock('@/features/notifications/useUnreadNotifications', () => ({ useUnreadNotifications: vi.fn() }));
vi.mock('@/features/notifications/appBadge', () => ({ clearAppBadge: vi.fn(), refreshAppBadge: vi.fn() }));

const room = vi.mocked(useRoom);
const notifications = vi.mocked(useUnreadNotifications);
const refresh = vi.mocked(refreshAppBadge);
const clear = vi.mocked(clearAppBadge);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('app badge synchronization', () => {
  it('refreshes after unread state changes and when the app regains focus', () => {
    vi.useFakeTimers();
    room.mockReturnValue({ unreadByConversation: new Map([['a', 2]]), messagesByConversation: new Map(), notificationsEnabled: true } as ReturnType<typeof useRoom>);
    notifications.mockReturnValue({ unread: 1, setUnread: vi.fn() });
    const view = render(<AppBadgeSync />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(refresh).toHaveBeenCalledOnce();

    room.mockReturnValue({ unreadByConversation: new Map([['a', 1]]), messagesByConversation: new Map(), notificationsEnabled: true } as ReturnType<typeof useRoom>);
    view.rerender(<AppBadgeSync />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(refresh).toHaveBeenCalledTimes(2);

    room.mockReturnValue({ unreadByConversation: new Map([['a', 1]]), messagesByConversation: new Map([['a', [{ msgId: 9 }]]]), notificationsEnabled: true } as ReturnType<typeof useRoom>);
    view.rerender(<AppBadgeSync />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(refresh).toHaveBeenCalledTimes(3);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('clears the icon and skips refresh when notifications are disabled', () => {
    vi.useFakeTimers();
    room.mockReturnValue({ unreadByConversation: new Map([['a', 2]]), messagesByConversation: new Map(), notificationsEnabled: false } as ReturnType<typeof useRoom>);
    notifications.mockReturnValue({ unread: 1, setUnread: vi.fn() });
    render(<AppBadgeSync />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(clear).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });
});
