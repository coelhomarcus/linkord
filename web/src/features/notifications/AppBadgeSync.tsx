import { useEffect, useMemo } from 'react';
import { useRoom } from '@/state/RoomContext';
import { clearAppBadge, refreshAppBadge } from './appBadge';
import { useUnreadNotifications } from './useUnreadNotifications';

export function AppBadgeSync() {
  const { unreadByConversation, messagesByConversation, notificationsEnabled } = useRoom();
  const { unread } = useUnreadNotifications();
  const messageUnread = useMemo(() => [...unreadByConversation.values()].reduce((total, count) => total + count, 0), [unreadByConversation]);
  const newestMessageId = useMemo(() => [...messagesByConversation.values()].reduce((latest, messages) => Math.max(latest, messages.at(-1)?.msgId ?? 0), 0), [messagesByConversation]);

  useEffect(() => {
    if (!notificationsEnabled) {
      void clearAppBadge();
      return;
    }
    let controller = new AbortController();
    const refresh = () => {
      controller.abort();
      controller = new AbortController();
      void refreshAppBadge(controller.signal);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    // Chat read acknowledgments are batched for one second; reconcile after
    // that write so the badge does not bring back an already-read message.
    const timer = window.setTimeout(refresh, 1500);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [messageUnread, newestMessageId, unread, notificationsEnabled]);

  return null;
}
