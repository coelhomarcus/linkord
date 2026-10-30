import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchUnreadNotificationCount } from '@/shared/api/api';
import { useFriends } from '@/features/friends/FriendsContext';
import { NotificationContext } from './notificationState';

export function NotificationStateProvider({ children }: { children: ReactNode }) {
  const { revision } = useFriends();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchUnreadNotificationCount()
      .then((res) => { if (!cancelled) setUnread(res.unread); })
      .catch(() => { /* The badge keeps its previous count until the next refresh. */ });
    return () => { cancelled = true; };
  }, [revision]);

  return <NotificationContext.Provider value={{ unread, setUnread }}>{children}</NotificationContext.Provider>;
}
