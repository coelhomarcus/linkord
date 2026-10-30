import { useState } from 'react';
import { useNavigate } from 'react-router';
import { clearNotifications, deleteNotification, markNotificationsRead } from '@/shared/api/api';
import type { NotificationEntry } from '@/shared/api/api';
import { ROUTES } from '@/shared/lib/routes';
import { useFriends } from '@/features/friends/FriendsContext';
import { useRoom } from '@/state/RoomContext';
import { notificationTarget } from './notificationText';
import { useUnreadNotifications } from './useUnreadNotifications';

export function useNotificationActions() {
  const navigate = useNavigate();
  const { bump } = useFriends();
  const { jumpToMessage } = useRoom();
  const { unread, setUnread } = useUnreadNotifications();
  const [error, setError] = useState(false);

  async function change(request: () => Promise<unknown>, nextUnread: number) {
    setError(false);
    setUnread(nextUnread);
    try {
      await request();
    } catch {
      setError(true);
    } finally {
      bump();
    }
  }

  function dismiss(entry: NotificationEntry) {
    void change(() => deleteNotification(entry.id), entry.read ? unread : Math.max(0, unread - 1));
  }

  function select(entry: NotificationEntry) {
    if (!entry.read) void change(() => markNotificationsRead({ ids: [entry.id] }), Math.max(0, unread - 1));
    if (entry.kind === 'mention' && entry.mention) {
      jumpToMessage(entry.mention.conversation.id, entry.mention.messageId);
      navigate(ROUTES.conversation(entry.mention.conversation.id));
    } else {
      navigate(notificationTarget(entry));
    }
  }

  return {
    unread, error, dismiss, select,
    markAll: () => void change(() => markNotificationsRead({ all: true }), 0),
    clearAll: () => void change(clearNotifications, 0),
  };
}
