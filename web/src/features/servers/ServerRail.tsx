import { PlusIcon } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, isHomePath, serverIdFromPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { CountBadge } from '@/shared/CountBadge';
import { useFriends } from '@/features/friends/FriendsContext';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from './ServerIcon';
import { CreateServerDialog } from './CreateServerDialog';
import { serverUnread } from './serverUtils';

/** Discord's pill on the left edge: tall for the open item, short for an
 * unread one, growing a little on hover. */
function Pill({ active, unread }: { active: boolean; unread: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute -left-3 top-1/2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary transition-[height] duration-150',
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
        className="group/server relative grid size-12 flex-none place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
      >
        <Pill active={active} unread={unread} />
        {children}
        {!!badge && (
          <CountBadge decorative className="absolute -bottom-0.5 -right-0.5 ring-4 ring-surface-rail">
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
  const currentServerId = serverIdFromPath(pathname);
  const home = isHomePath(pathname) || pathname.startsWith('/app/calls/');
  const directUnread = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.type === 'direct' ? unreadByConversation.get(c.id) ?? 0 : 0), 0),
    [conversations, unreadByConversation],
  );

  return (
    <nav aria-label={t('rail.label')} className={cn('flex w-[72px] flex-none flex-col items-center gap-2 overflow-y-auto bg-surface-rail pt-3 pb-[max(0.75rem,var(--dock-clearance,0px))] [scrollbar-width:none]', className)}>
      <RailItem label={t('rail.home')} active={home} unread={false} badge={directUnread + pendingIncomingCount} onClick={() => navigate(ROUTES.home)}>
        <span className={cn('grid size-12 place-items-center bg-primary transition-[border-radius] duration-150', home ? 'rounded-[30%]' : 'rounded-[50%] group-hover/server:rounded-[30%]')}>
          <img src="/logo.svg" alt="" className="size-7 brightness-0 invert" />
        </span>
      </RailItem>
      <span aria-hidden className="h-0.5 w-8 flex-none rounded-full bg-border" />
      {servers.map((server) => {
        const unread = serverUnread(server, unreadByConversation);
        return (
          <RailItem
            key={server.id}
            label={server.name}
            active={server.id === currentServerId}
            unread={unread > 0}
            onClick={() => navigate(ROUTES.server(server.id))}
          >
            <ServerIcon id={server.id} name={server.name} icon={server.icon} active={server.id === currentServerId} className={server.status === 'suspended' ? 'opacity-40 grayscale' : undefined} />
          </RailItem>
        );
      })}
      <RailItem label={t('rail.add')} active={false} unread={false} onClick={() => setCreateOpen(true)}>
        <span className="grid size-12 place-items-center rounded-[50%] bg-bg-secondary text-green transition-[border-radius,background-color,color] duration-150 group-hover/server:rounded-[30%] group-hover/server:bg-green-solid group-hover/server:text-white">
          <PlusIcon size={24} weight="bold" />
        </span>
      </RailItem>
      <CreateServerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </nav>
  );
}
