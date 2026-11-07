import { ChecksIcon, TrashIcon, TrayIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { NotificationList } from './NotificationList';
import { useNotificationActions } from './useNotificationActions';
import { NotificationStateProvider } from './NotificationStateProvider';
import { useHasNotificationState } from './useUnreadNotifications';

const INBOX_ACTION = 'grid size-9 flex-none place-items-center rounded-lg border border-border-control bg-bg-control text-text-primary transition-colors hover:bg-bg-control-hover disabled:pointer-events-none disabled:opacity-50';

export function NotificationBell({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const hasState = useHasNotificationState();
  if (!hasState) return <NotificationStateProvider><NotificationBellContent collapsed={collapsed} onNavigate={onNavigate} /></NotificationStateProvider>;
  return <NotificationBellContent collapsed={collapsed} onNavigate={onNavigate} />;
}

function NotificationBellContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation('notifications');
  const { unread, error, dismiss, select, markAll, clearAll } = useNotificationActions();
  const [open, setOpen] = useState(false);

  const label = unread > 0 ? t('bell.unread', { count: unread }) : t('title');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={collapsed
          ? 'relative grid size-7 place-items-center rounded-md text-text-secondary transition-colors hover:text-text-primary aria-expanded:text-text-strong'
          : cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative flex-none text-text-secondary hover:text-text-primary')}
      >
        <TrayIcon size={20} weight="fill" />
        {unread > 0 && <span aria-hidden data-testid="unread-dot" className="absolute right-1 top-1 size-2 rounded-full bg-primary" />}
      </PopoverTrigger>
      {/* Discord's inbox: a dark panel under the title bar, its title with the
          tray, and square actions on the right */}
      <PopoverContent side="bottom" align="end" sideOffset={6} className="w-[min(30rem,calc(100vw-1.5rem))] gap-0 rounded-[12px] border-border-default bg-bg-modal p-0">
        <div className="flex items-center gap-2 border-b border-border-default px-4 py-4">
          <TrayIcon size={24} weight="fill" className="flex-none text-text-primary" aria-hidden />
          <h2 className="flex-1 select-none text-[1.25rem] font-bold leading-[1.2] text-text-strong">{t('title')}</h2>
          <Tooltip>
            <TooltipTrigger
              aria-label={t('actions.markAllRead')}
              disabled={unread === 0}
              onClick={markAll}
              className={INBOX_ACTION}
            >
              <ChecksIcon size={18} weight="bold" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('actions.markAllRead')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              aria-label={t('actions.clearAll')}
              onClick={clearAll}
              className={cn(INBOX_ACTION, 'hover:text-red-text')}
            >
              <TrashIcon size={18} weight="fill" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('actions.clearAll')}</TooltipContent>
          </Tooltip>
        </div>
        {error && <p role="alert" className="mx-3 mt-3 rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">{t('actions.updateFailed')}</p>}
        <div className="p-2">
          <NotificationList onSelect={(entry) => { setOpen(false); select(entry); onNavigate?.(); }} onDismiss={dismiss} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
