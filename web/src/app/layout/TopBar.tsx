import { useTranslation } from 'react-i18next';
import { UsersIcon } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { ROUTES, isHomePath } from '@/shared/lib/routes';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { ServerIcon } from '@/features/servers/ServerIcon';
import type { ServerSummary } from '@/shared/types/protocol';

/** Discord's window title strip: where you are, centred, and the inbox on the right. */
export function TopBar({ className, title, server }: { className?: string; title?: string; server: ServerSummary | null }) {
  const { t } = useTranslation('servers');
  const { pathname } = useContentLocation();
  const onFriends = pathname === ROUTES.home || pathname === ROUTES.friends;
  const label = server ? server.name : onFriends ? t('topBar.friends') : isHomePath(pathname) ? t('topBar.directMessages') : title ?? 'Linkord';
  return (
    <header className={cn('relative h-9 flex-none items-center justify-center bg-surface-rail px-3', className)}>
      <span className="flex min-w-0 items-center gap-2 text-label font-semibold text-text-primary">
        {server ? <ServerIcon id={server.id} name={server.name} icon={server.icon} size={18} active /> : onFriends ? <UsersIcon size={18} weight="fill" /> : <img src="/logo.svg" alt="" className="size-4" />}
        <span className="truncate">{label}</span>
      </span>
      <span className="absolute right-2 top-1/2 -translate-y-1/2"><NotificationBell collapsed /></span>
    </header>
  );
}
