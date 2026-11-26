import { ArrowDownIcon, ArrowUpIcon, PlusIcon, SidebarSimpleIcon, SpeakerHighIcon } from '@/shared/ui/icons';
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, HTMLAttributes, PointerEvent, ReactNode } from 'react';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RowMenu, RowMenuButton } from '@/shared/RowMenu';
import { useRowMenu } from '@/shared/hooks/useRowMenu';
import { DropdownMenuItem } from '@/shared/ui/primitives/dropdown-menu';
import { announce } from '@/shared/lib/announce';
import { DirectMenuItems } from '@/features/conversations/DirectMenuItems';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, callConversationIdFromPath, conversationIdFromPath, isHomePath, serverIdFromPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { CountBadge } from '@/shared/CountBadge';
import { Avatar } from '@/shared/Avatar';
import { useFriends } from '@/features/friends/FriendsContext';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { useCallRoster } from '@/features/calls/callRoster';
import { OvercordMark } from '@/shared/ui/OvercordMark';
import { ServerIcon } from '@overcord/frontend-shared/ui/ServerIcon';
import { CreateServerDialog } from './CreateServerDialog';
import { liveCallIds, serverHasLiveCall, serverUnread } from './serverUtils';
import { railDirects } from './railDirects';
import { saveServerOrder } from './serversApi';
import { ServerActionDialog, ServerMenuItems, type ServerMenuAction } from './ServerMenu';

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
// unread count bottom-right, so the two never sit on each other. Each reaches
// 6px past the tile (2px offset, 4px ring), and the rail spaces its tiles 12px
// apart, so a seal never meets the count of the tile above: at 8px apart with
// a 4px offset it sat on top of it.
const CORNER = 'pointer-events-none absolute ring-4 ring-surface-rail';

function RailItem({ label, active, unread, badge, badgeLabel, badgeClassName, liveCall, onClick, children, dragging = false, sortable, serverId, conversationId, menuItems }: {
  label: string; active: boolean; unread: boolean; badge?: number; onClick: () => void; children: ReactNode;
  serverId?: string;
  menuItems?: ReactNode;
  conversationId?: string;
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
  const menu = useRowMenu();
  const accessibleName = [label, badge ? badgeLabel : undefined, liveCall].filter(Boolean).join(', ');
  const button = (
    <Tooltip disabled={dragging}>
      <TooltipTrigger
        {...sortable?.props}
        {...(menuItems ? menu.primaryProps : undefined)}
        ref={sortable?.ref}
        style={sortable?.style}
        onClick={onClick}
        onDragStart={blockNativeDrag}
        data-server-id={serverId}
        data-conversation-id={conversationId}
        aria-label={accessibleName}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group/server relative grid size-10 flex-none touch-pan-y select-none place-items-center rounded-[12px] focus-ring [-webkit-user-drag:none]',
          dragging && 'z-10 cursor-grabbing',
        )}
      >
        <Pill active={active} unread={unread} />
        {children}
        {liveCall && (
          <span aria-hidden data-testid="live-call-seal" className={cn(CORNER, '-right-0.5 -top-0.5 grid size-4.5 place-items-center rounded-full bg-green-solid text-white')}>
            <SpeakerHighIcon size={10} weight="fill" />
          </span>
        )}
        {!!badge && (
          <CountBadge decorative className={cn(CORNER, '-bottom-0.5 -right-0.5', badgeClassName)}>
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
  if (!menuItems) return button;
  return (
    <div {...menu.rowProps} className="relative flex-none">
      {button}
      <RowMenuButton menu={menu} name={label}
        className="sr-only z-10 size-6 bg-surface-400 focus-visible:not-sr-only focus-visible:absolute focus-visible:-bottom-1 focus-visible:-right-1" />
      <RowMenu menu={menu}>{menuItems}</RowMenu>
    </div>
  );
}

/** A server in the rail that can be dragged to a new place in it. */
function SortableServerItem({ id, suppressClick, reorderDisabled, ...item }: Omit<Parameters<typeof RailItem>[0], 'sortable' | 'dragging'> & { id: string; suppressClick: () => boolean; reorderDisabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: reorderDisabled });
  return (
    <RailItem
      {...item}
      // the press that ends a drag is not a click on the server it dropped
      onClick={() => { if (!suppressClick()) item.onClick(); }}
      dragging={isDragging}
      sortable={{ ref: setNodeRef, style: { transform: CSS.Translate.toString(transform), transition }, props: {
        ...attributes, ...listeners,
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          if (event.pointerType === 'mouse') listeners?.onPointerDown?.(event);
        },
      } }}
    />
  );
}

/** The far-left column: home (friends and DMs) on top, then every server the
 * account is in, then creating or joining one. Servers are dragged to reorder
 * them, as in Discord's rail; the order is the account's own. */
export function ServerRail({ className, onOpenProfile }: { className?: string; onOpenProfile?: (userId: string) => void }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { pathname } = useContentLocation();
  const { servers, conversations, badgeByConversation, reorderServers, activeCallConversationId, allUsers, dmCall, closeConversation } = useRoom('servers', 'conversations', 'badgeByConversation', 'reorderServers', 'activeCallConversationId', 'allUsers', 'dmCall', 'closeConversation');
  const state = useRoomState('me');
  const roster = useCallRoster();
  const callIds = useMemo(() => liveCallIds(roster.values(), activeCallConversationId), [roster, activeCallConversationId]);
  // a press only becomes a drag past a few pixels, so a click still opens the server
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const draggedAtRef = useRef(0);
  const suppressClick = () => Date.now() - draggedAtRef.current < 250;

  const orderPending = useRef(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [action, setAction] = useState<{ serverId: string; action: ServerMenuAction } | null>(null);
  const actionServer = servers.find((server) => server.id === action?.serverId);

  async function moveServer(id: string, to: number) {
    if (orderPending.current) return;
    const before = servers.map((server) => server.id);
    const from = before.indexOf(id);
    if (from < 0 || to < 0 || to >= before.length || from === to) return;
    const after = arrayMove(before, from, to);
    orderPending.current = true;
    setSavingOrder(true);
    reorderServers(after);
    try {
      await saveServerOrder(after);
      reorderServers(after);
    } catch {
      reorderServers(before);
      announce(t('menu.orderFailed'));
    }
    orderPending.current = false;
    setSavingOrder(false);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    draggedAtRef.current = Date.now();
    if (over) void moveServer(String(active.id), servers.findIndex((server) => server.id === over.id));
  }
  const { pendingIncomingCount } = useFriends();
  const [createOpen, setCreateOpen] = useState(false);
  const { isMobile, isOverlay, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  // between phone and desktop the column is a drawer: the rail opens it, and
  // picking a place shows that place's column
  const drawer = isOverlay && !isMobile;
  const go = (to: string) => { navigate(to); if (drawer) setOpenMobile(true); };
  const currentServerId = serverIdFromPath(pathname);
  const home = isHomePath(pathname) || pathname.startsWith('/calls/');
  const directs = useMemo(() => railDirects({
    conversations, myUserId: state.me.userId, unreadByConversation: badgeByConversation, activeCallConversationId, dmCall,
  }), [conversations, state.me.userId, badgeByConversation, activeCallConversationId, dmCall]);
  const openConversationId = conversationIdFromPath(pathname) ?? callConversationIdFromPath(pathname);

  return (
    <nav aria-label={t('rail.label')} className={cn('flex w-[72px] flex-none flex-col items-center gap-3 overflow-y-auto bg-surface-rail pb-[max(0.75rem,var(--dock-clearance,0px))] [scrollbar-width:none] max-md:pt-3', className)}>
      {drawer && (
        <Tooltip>
          <TooltipTrigger onClick={toggleSidebar} aria-label={t('rail.showList')} aria-expanded={openMobile}
            className={cn('grid size-10 flex-none place-items-center rounded-[12px] text-text-secondary transition-colors duration-100 focus-ring hover:bg-surface-400 hover:text-text-primary', openMobile ? 'bg-surface-400 text-text-primary' : 'bg-surface-300')}>
            <SidebarSimpleIcon size={24} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">{t('rail.showList')}</TooltipContent>
        </Tooltip>
      )}
      <RailItem label={t('rail.home')} active={home} unread={false} badge={pendingIncomingCount} onClick={() => go(ROUTES.home)}>
        {/* The home tile fills with the accent while it is open or hovered, and
            the mark takes the accent's label colour on it. Its eyes are holes,
            so the tile shows through them. */}
        <span className={cn('grid size-10 place-items-center rounded-[12px] transition-colors duration-150', home ? 'bg-accent-primary' : 'bg-surface-300 group-hover/server:bg-accent-primary')}>
          <OvercordMark className={cn('h-auto w-6 transition-colors duration-150', home ? 'text-primary-foreground' : 'text-logo group-hover/server:text-primary-foreground')} />
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
            conversationId={row.conversationId}
            onClick={() => go(ROUTES.direct(row.conversationId))}
            menuItems={<DirectMenuItems id={row.conversationId}
              onOpenProfile={onOpenProfile && (() => onOpenProfile(row.peerId))}
              onClose={() => {
                closeConversation(row.conversationId);
                if (openConversationId === row.conversationId) navigate(ROUTES.home, { replace: true });
              }} />}
          >
            <Avatar id={row.peerId} name={name} avatar={person?.avatar ?? ''} poster={person?.avatarPoster} avatarColor={person?.avatarColor ?? ''} size={40} />
          </RailItem>
        );
      })}
      <span aria-hidden className="h-px w-8 flex-none bg-border-subtle" />
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[alongRail]} onDragStart={() => { draggedAtRef.current = Date.now(); }} onDragEnd={handleDragEnd} onDragCancel={() => { draggedAtRef.current = Date.now(); }}>
        <SortableContext items={servers.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {servers.map((server, index) => {
            const unread = serverUnread(server, badgeByConversation);
            return (
              <SortableServerItem
                key={server.id}
                id={server.id}
                serverId={server.id}
                suppressClick={suppressClick}
                reorderDisabled={savingOrder}
                menuItems={<ServerMenuItems server={server} onAction={(next) => setAction({ serverId: server.id, action: next })}
                  orderActions={servers.length > 1 && (
                    <>
                      <DropdownMenuItem disabled={savingOrder || index === 0} onClick={() => void moveServer(server.id, index - 1)}>
                        <ArrowUpIcon size={16} />{t('menu.moveUp')}
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={savingOrder || index === servers.length - 1} onClick={() => void moveServer(server.id, index + 1)}>
                        <ArrowDownIcon size={16} />{t('menu.moveDown')}
                      </DropdownMenuItem>
                    </>
                  )} />}
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
          <PlusIcon size={20} weight="fill" />
        </span>
      </RailItem>
      {actionServer && action && <ServerActionDialog key={actionServer.id} server={actionServer} action={action.action} onClose={() => setAction(null)} />}
      <CreateServerDialog open={createOpen} onOpenChange={setCreateOpen} />
    </nav>
  );
}
