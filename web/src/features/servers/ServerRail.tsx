import { PlusIcon, SidebarSimpleIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, isHomePath, serverIdFromPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { CountBadge } from '@/shared/CountBadge';
import { useFriends } from '@/features/friends/FriendsContext';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from './ServerIcon';
import { CreateServerDialog } from './CreateServerDialog';
import { serverUnread } from './serverUtils';

/** Discord's pill on the rail's left edge: tall for the open item, short for
 * an unread one, growing a little on hover. */
function Pill({ active, unread }: { active: boolean; unread: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -left-4 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary transition-[height] duration-150',
        active ? 'h-10' : unread ? 'h-2 group-hover/server:h-5' : 'h-0 group-hover/server:h-5',
      )}
    />
  );
}

function RailItem({ label, active, unread, badge, onClick, children }: {
  label: string; active: boolean; unread: boolean; badge?: number; onClick: () => void; children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        className="group/server relative grid size-10 flex-none place-items-center rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Pill active={active} unread={unread} />
        {children}
        {!!badge && (
          <CountBadge decorative className="absolute -bottom-1 -right-1 ring-4 ring-surface-rail">
            {badge > 99 ? '99+' : badge}
          </CountBadge>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" className="text-label font-semibold">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The far-left column: home (friends and DMs) on top, then every server the
 * account is in, then creating or joining one. */
export function ServerRail({ className }: { className?: string }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { pathname } = useContentLocation();
  const { servers, conversations, unreadByConversation } = useRoom();
  const { pendingIncomingCount } = useFriends();
  const [createOpen, setCreateOpen] = useState(false);
  const { isMobile, isOverlay, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  // between phone and desktop the column is a drawer: the rail opens it, and
  // picking a place shows that place's column
  const drawer = isOverlay && !isMobile;
  const go = (to: string) => { navigate(to); if (drawer) setOpenMobile(true); };
  const currentServerId = serverIdFromPath(pathname);
  const home = isHomePath(pathname) || pathname.startsWith('/app/calls/');
  const directUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.type === 'direct' ? unreadByConversation.get(c.id) ?? 0 : 0), 0),
    [conversations, unreadByConversation],
  );

  return (
    <nav aria-label={t('rail.label')} className={cn('flex w-[72px] flex-none flex-col items-center gap-2 overflow-y-auto bg-surface-rail pb-[max(0.75rem,var(--dock-clearance,0px))] [scrollbar-width:none] max-md:pt-3', className)}>
      {drawer && (
        <Tooltip>
          <TooltipTrigger onClick={toggleSidebar} aria-label={t('rail.showList')} aria-expanded={openMobile}
            className="grid size-10 flex-none place-items-center rounded-[12px] bg-surface-300 text-text-secondary outline-none hover:bg-surface-400 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-ring">
            <SidebarSimpleIcon size={24} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">{t('rail.showList')}</TooltipContent>
        </Tooltip>
      )}
      <RailItem label={t('rail.home')} active={home} unread={false} badge={directUnread + pendingIncomingCount} onClick={() => go(ROUTES.home)}>
        {/* Discord's home tile: blurple with a white logo while home is open;
            the logo's eyes are cut out, so the tile shows through them */}
        <span className={cn('grid size-10 place-items-center rounded-[12px] transition-colors duration-150', home ? 'bg-accent-primary' : 'bg-surface-300 group-hover/server:bg-accent-primary')}>
          <img src="/logo.svg" alt="" className={cn('h-auto w-6', home ? 'brightness-0 invert' : 'group-hover/server:brightness-0 group-hover/server:invert')} />
        </span>
      </RailItem>
      <span aria-hidden className="h-px w-8 flex-none bg-border-subtle" />
      {servers.map((server) => {
        const unread = serverUnread(server, unreadByConversation);
        return (
          <RailItem
            key={server.id}
            label={server.name}
            active={server.id === currentServerId}
            unread={unread > 0}
            onClick={() => go(ROUTES.server(server.id))}
          >
            <ServerIcon id={server.id} name={server.name} icon={server.icon} size={40} className={server.status === 'suspended' ? 'opacity-40 grayscale' : undefined} />
          </RailItem>
        );
      })}
      <RailItem label={t('rail.add')} active={false} unread={false} onClick={() => setCreateOpen(true)}>
        <span className="grid size-10 place-items-center rounded-[12px] bg-surface-300 text-text-primary transition-colors duration-150 group-hover/server:bg-accent-primary group-hover/server:text-white">
          <PlusIcon size={20} weight="bold" />
        </span>
      </RailItem>
      <CreateServerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </nav>
  );
}
