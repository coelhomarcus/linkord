import { useContext } from 'react';
import { NotificationContext } from './notificationState';

export function useUnreadNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error('NotificationStateProvider is missing');
  return value;
}

export function useHasNotificationState() {
  return useContext(NotificationContext) !== null;
}
