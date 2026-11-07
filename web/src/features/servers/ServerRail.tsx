import { PlusIcon, SidebarSimpleIcon, SpeakerHighIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, HTMLAttributes, ReactNode } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, callConversationIdFromPath, conversationIdFromPath, isHomePath, serverIdFromPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { CountBadge } from '@/shared/CountBadge';
import { Avatar } from '@/shared/Avatar';
import { useFriends } from '@/features/friends/FriendsContext';
import { useRoom } from '@/state/RoomContext';
import { ServerIcon } from './ServerIcon';
import { CreateServerDialog } from './CreateServerDialog';
import { liveCallIds, serverHasLiveCall, serverUnread } from './serverUtils';
import { railDirects } from './railDirects';
import { saveServerOrder } from './serversApi';

// the rail is one column: a dragged server only travels up and down it
const alongRail: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// A browser drags an <img> (or a link) on its own, as a file to drop
// elsewhere: started on a server's picture that ghost image took the pointer
// and the reorder never saw the move. Nothing in the rail is a native drag.
const blockNativeDrag = (event: DragEvent) => event.preventDefault();

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

// The tile's corners, each with one job: the live-call seal top-right, the
// unread count bottom-right, so the two never sit on each other.
const CORNER = 'pointer-events-none absolute ring-4 ring-surface-rail';

function RailItem({ label, active, unread, badge, badgeLabel, badgeClassName, liveCall, onClick, children, dragging = false, sortable }: {
  label: string; active: boolean; unread: boolean; badge?: number; onClick: () => void; children: ReactNode;
  /** what the count means, for the item's accessible name; without it the count is left out of the name */
  badgeLabel?: string;
  badgeClassName?: string;
  /** set while a voice channel has someone in it: the seal's wording */
  liveCall?: string;
  /** while this item is the one being dragged: no tooltip trailing it */
  dragging?: boolean;
  /** what makes the item a handle of the rail's sortable list */
  sortable?: { ref: (node: HTMLElement | null) => void; style: CSSProperties; props: HTMLAttributes<HTMLElement> };
}) {
  const accessibleName = [label, badge ? badgeLabel : undefined, liveCall].filter(Boolean).join(', ');
  return (
    <Tooltip disabled={dragging}>
      <TooltipTrigger
        {...sortable?.props}
        ref={sortable?.ref}
        style={sortable?.style}
        onClick={onClick}
        onDragStart={blockNativeDrag}
        aria-label={accessibleName}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group/server relative grid size-10 flex-none touch-none select-none place-items-center rounded-[12px] outline-none [-webkit-user-drag:none] focus-visible:ring-2 focus-visible:ring-ring',
          dragging && 'z-10 cursor-grabbing',
        )}
      >
        <Pill active={active} unread={unread} />
        {children}
        {liveCall && (
          <span aria-hidden data-testid="live-call-seal" className={cn(CORNER, '-right-1 -top-1 grid size-4.5 place-items-center rounded-full bg-green-solid text-white')}>
            <SpeakerHighIcon size={10} weight="fill" />
          </span>
        )}
        {!!badge && (
          <CountBadge decorative className={cn(CORNER, '-bottom-1 -right-1', badgeClassName)}>
            {badge > 99 ? '99+' : badge}
          </CountBadge>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" className="flex flex-col gap-0.5 text-label font-semibold">
        <span>{label}</span>
        {liveCall && (
          <span className="flex items-center gap-1 text-caption font-medium">
            <SpeakerHighIcon size={12} weight="fill" className="text-green" aria-hidden />
            {liveCall}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** A server in the rail that can be dragged to a new place in it. */
function SortableServerItem({ id, suppressClick, ...item }: Omit<Parameters<typeof RailItem>[0], 'sortable' | 'dragging'> & { id: string; suppressClick: () => boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <RailItem
      {...item}
      // the press that ends a drag is not a click on the server it dropped
      onClick={() => { if (!suppressClick()) item.onClick(); }}
      dragging={isDragging}
      sortable={{ ref: setNodeRef, style: { transform: CSS.Translate.toString(transform), transition }, props: { ...attributes, ...listeners } }}
    />
  );
}

/** The far-left column: home (friends and DMs) on top, then every server the
 * account is in, then creating or joining one. Servers are dragged to reorder
 * them, as in Discord's rail; the order is the account's own. */
export function ServerRail({ className }: { className?: string }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { pathname } = useContentLocation();
  const { state, servers, conversations, unreadByConversation, reorderServers, activeCallConversationId, allUsers, dmCall } = useRoom();
  const callIds = useMemo(() => liveCallIds(state.participants.values(), activeCallConversationId), [state.participants, activeCallConversationId]);
  // a press only becomes a drag past a few pixels, so a click still opens the server
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const draggedAtRef = useRef(0);
  const suppressClick = () => Date.now() - draggedAtRef.current < 250;

  function handleDragEnd({ active, over }: DragEndEvent) {
    draggedAtRef.current = Date.now();
    if (!over || active.id === over.id) return;
    const before = servers.map((s) => s.id);
    const after = arrayMove(before, before.indexOf(String(active.id)), before.indexOf(String(over.id)));
    reorderServers(after);
    // the rail already moved; a refused save puts it back
    saveServerOrder(after).catch(() => reorderServers(before));
  }
  const { pendingIncomingCount } = useFriends();
  const [createOpen, setCreateOpen] = useState(false);
  const { isMobile, isOverlay, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  // between phone and desktop the column is a drawer: the rail opens it, and
  // picking a place shows that place's column
  const drawer = isOverlay && !isMobile;
  const go = (to: string) => { navigate(to); if (drawer) setOpenMobile(true); };
  const currentServerId = serverIdFromPath(pathname);
  const home = isHomePath(pathname) || pathname.startsWith('/app/calls/');
  const directs = useMemo(() => railDirects({
    conversations, myUserId: state.me.userId, unreadByConversation, activeCallConversationId, dmCall,
  }), [conversations, state.me.userId, unreadByConversation, activeCallConversationId, dmCall]);
  const openConversationId = conversationIdFromPath(pathname) ?? callConversationIdFromPath(pathname);

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
      <RailItem label={t('rail.home')} active={home} unread={false} badge={pendingIncomingCount} onClick={() => go(ROUTES.home)}>
        {/* The home tile fills with the accent while it is open or hovered.
            The logo's eyes are cut out, so the tile shows through them; the
            mark itself is forced white on that fill. */}
        <span className={cn('grid size-10 place-items-center rounded-[12px] transition-colors duration-150', home ? 'bg-accent-primary' : 'bg-surface-300 group-hover/server:bg-accent-primary')}>
          <img src="/logo.svg" alt="" draggable={false} className={cn('h-auto w-6', home ? '[filter:var(--accent-mark-filter)]' : 'group-hover/server:[filter:var(--accent-mark-filter)]')} />
        </span>
      </RailItem>
      {directs.map((row) => {
        const person = allUsers.get(row.peerId);
        const name = person?.displayName || row.peerId;
        return (
          <RailItem
            key={row.conversationId}
            label={name}
            active={openConversationId === row.conversationId}
            unread={row.unread > 0}
            badge={row.unread}
            badgeLabel={row.unread > 0 ? t('rail.unread', { count: row.unread }) : undefined}
            badgeClassName="bg-red text-white"
            liveCall={row.inCall ? t('rail.liveCall') : undefined}
            onClick={() => go(ROUTES.direct(row.conversationId))}
          >
            <Avatar id={row.peerId} name={name} avatar={person?.avatar ?? ''} poster={person?.avatarPoster} avatarColor={person?.avatarColor ?? ''} size={40} />
          </RailItem>
        );
      })}
      <span aria-hidden className="h-px w-8 flex-none bg-border-subtle" />
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[alongRail]} onDragStart={() => { draggedAtRef.current = Date.now(); }} onDragEnd={handleDragEnd} onDragCancel={() => { draggedAtRef.current = Date.now(); }}>
        <SortableContext items={servers.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {servers.map((server) => {
            const unread = serverUnread(server, unreadByConversation);
            return (
              <SortableServerItem
                key={server.id}
                id={server.id}
                suppressClick={suppressClick}
                label={server.name}
                active={server.id === currentServerId}
                unread={unread > 0}
                badge={unread}
                badgeLabel={t('rail.unread', { count: unread })}
                badgeClassName="bg-red text-white"
                liveCall={serverHasLiveCall(server, callIds) ? t('rail.liveCall') : undefined}
                onClick={() => go(ROUTES.server(server.id))}
              >
                <ServerIcon id={server.id} name={server.name} icon={server.icon} size={40} className={server.status === 'suspended' ? 'opacity-40 grayscale' : undefined} />
              </SortableServerItem>
            );
          })}
        </SortableContext>
      </DndContext>
      <RailItem label={t('rail.add')} active={false} unread={false} onClick={() => setCreateOpen(true)}>
        <span className="grid size-10 place-items-center rounded-[12px] bg-surface-300 text-text-primary transition-colors duration-150 group-hover/server:bg-accent-primary group-hover/server:text-primary-foreground">
          <PlusIcon size={20} weight="bold" />
        </span>
      </RailItem>
      <CreateServerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </nav>
  );
}
