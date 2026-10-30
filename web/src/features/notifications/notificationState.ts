import { createContext } from 'react';

export type NotificationState = { unread: number; setUnread: (count: number) => void };
export const NotificationContext = createContext<NotificationState | null>(null);
