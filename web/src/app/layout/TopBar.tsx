import { useTranslation } from 'react-i18next';
import { UsersIcon } from '@/shared/ui/icons';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { ROUTES, isHomePath } from '@/shared/lib/routes';
import { DesktopUpdateButton } from '@/features/desktopApp/DesktopUpdateButton';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ServerIcon } from '@/features/servers/ServerIcon';
import type { ServerSummary } from '@/shared/types/protocol';
import { useTitleBarHost } from '@/app/layout/titleBar';
import { WindowControls } from '@/app/layout/WindowControls';
import { LinkordMark } from '@/shared/ui/LinkordMark';

/**
 * Discord's window title strip: where you are, centred, and the inbox on the
 * right. In the desktop app it is also the window's title bar: it drags the
 * window and ends with the window's buttons.
 */
export function TopBar({ className, title, server }: { className?: string; title?: string; server: ServerSummary | null }) {
  const { t } = useTranslation('servers');
  const host = useTitleBarHost();
  const { pathname } = useContentLocation();
  const onFriends = pathname === ROUTES.home || pathname === ROUTES.friends;
  const label = server ? server.name : onFriends ? t('topBar.friends') : isHomePath(pathname) ? t('topBar.directMessages') : title ?? 'Linkord';
  return (
    <header className={cn('relative h-titlebar flex-none items-center justify-center bg-surface-rail px-3', host && 'app-drag', className)}>
      <span className="flex min-w-0 items-center gap-2 text-label font-medium text-text-primary">
        {server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={18} /> : onFriends ? <UsersIcon size={18} weight="fill" /> : <LinkordMark className="size-4 text-logo" />}
        <span className="truncate">{label}</span>
      </span>
      <span className={cn('absolute inset-y-0 right-0 flex items-center', !host && 'pr-2')}>
        {host && <DesktopUpdateButton className="mr-1" />}
        <span className="app-no-drag flex items-center"><NotificationBell collapsed /></span>
        {host && <WindowControls controls={host.controls} platform={host.platform} className="ml-1" />}
      </span>
    </header>
  );
}
