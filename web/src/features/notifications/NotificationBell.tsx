import { BellIcon, ChecksIcon, TrashIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { CountBadge } from '@/shared/CountBadge';
import { NotificationList } from './NotificationList';
import { formatUnread } from './notificationText';
import { useNotificationActions } from './useNotificationActions';
import { NotificationStateProvider } from './NotificationStateProvider';
import { useHasNotificationState } from './useUnreadNotifications';

export function NotificationBell({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const hasState = useHasNotificationState();
  if (!hasState) return <NotificationStateProvider><NotificationBellContent collapsed={collapsed} onNavigate={onNavigate} /></NotificationStateProvider>;
  return <NotificationBellContent collapsed={collapsed} onNavigate={onNavigate} />;
}

function NotificationBellContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { unread, error, dismiss, select, markAll, clearAll } = useNotificationActions();
  const [open, setOpen] = useState(false);

  const label = unread > 0 ? `Notificações, ${unread} não lida${unread === 1 ? '' : 's'}` : 'Notificações';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={collapsed
          ? 'relative grid size-11 place-items-center rounded-md text-text-muted transition-colors hover:bg-fill-hover hover:text-text-primary'
          : cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative flex-none text-text-muted hover:text-text-primary')}
      >
        <BellIcon size={20} />
        {unread > 0 && (
          <CountBadge decorative className="absolute -right-1 -top-1">
            {formatUnread(unread)}
          </CountBadge>
        )}
      </PopoverTrigger>
      <PopoverContent side={collapsed ? 'right' : 'bottom'} align="start" className="w-[min(22rem,calc(100vw-1.5rem))] bg-bg-modal">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 className="select-none text-label font-semibold text-text-primary">Notificações</h2>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                aria-label="Marcar todas como lidas"
                disabled={unread === 0}
                onClick={markAll}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-text-muted hover:text-text-primary')}
              >
                <ChecksIcon size={16} />
              </TooltipTrigger>
              <TooltipContent side="bottom">Marcar todas como lidas</TooltipContent>
            </Tooltip>
            <button
              type="button"
              aria-label="Limpar tudo"
              onClick={clearAll}
              className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-text-muted hover:text-red')}
            >
              <TrashIcon size={16} />
            </button>
          </div>
        </div>
        {error && <p role="alert" className="rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">Não foi possível atualizar. Tente de novo.</p>}
        <NotificationList onSelect={(entry) => { setOpen(false); select(entry); onNavigate?.(); }} onDismiss={dismiss} />
      </PopoverContent>
    </Popover>
  );
}
