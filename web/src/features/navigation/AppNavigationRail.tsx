import { ChatCircleIcon, SidebarSimpleIcon, UsersIcon } from '@phosphor-icons/react';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, isConversationsPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useContentLocation } from '@/shared/lib/contentLocation';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { ActiveWash } from '@/shared/ui/motion/active-wash';
import { useFriends } from '@/features/friends/FriendsContext';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { CountBadge } from '@/shared/CountBadge';
import { iconWeight } from '@/shared/ui/icons';
import { AppLink } from '@/shared/ui/app-link';

const itemClass = 'relative isolate grid size-11 place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

// the active item's look comes from the wash and marker below, which slide
// between items instead of fading out on one and in on another
function stateClass(active: boolean): string {
  return active ? 'text-text-primary' : 'text-text-muted hover:bg-fill-hover hover:text-text-primary';
}

/** The ids shared by every item of one rail, so its wash and marker are one of
 * each, travelling from item to item. */
interface RailIndicatorIds { wash: string; marker: string }

/** A short bar on the edge: the selected destination isn't told by colour alone. */
function ActiveMarker({ layoutId }: { layoutId: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden
      transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
      className="absolute -left-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-text-primary"
    />
  );
}

function RailBadge({ count }: { count: number }) {
  return (
    <CountBadge decorative className="absolute -right-0.5 -top-0.5">
      {count > 99 ? '99+' : count}
    </CountBadge>
  );
}

// the rail's flex gap (gap-1.5): a closed slot pulls it back so it takes no room at all
const COLLAPSED_SLOT = { height: 0, marginBottom: -6, opacity: 0, scale: 0.6, overflow: 'hidden' } as const;

/** An item that comes and goes with the conversation list grows into its slot,
 * so the items below glide down instead of jumping a whole slot at once. */
function RailSlot({ show, children }: { show: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={COLLAPSED_SLOT}
          // clipped only while it moves: at rest the focus ring and a badge reach past the slot
          animate={{ height: 'auto', marginBottom: 0, opacity: 1, scale: 1, transitionEnd: { overflow: 'visible' } }}
          exit={COLLAPSED_SLOT}
          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
          className="flex flex-none flex-col items-center self-stretch"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RailLink({ to, label, active, badge, onNavigate, indicators, children }: {
  to: string;
  label: string;
  active: boolean;
  badge?: number;
  onNavigate: () => void;
  indicators: RailIndicatorIds;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<AppLink to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={label} className={cn(itemClass, stateClass(active))} />}
      >
        {active && <ActiveWash layoutId={indicators.wash} className="shadow-highlight" />}
        {active && <ActiveMarker layoutId={indicators.marker} />}
        {children}
        {!!badge && <RailBadge count={badge} />}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The global navigation: where you can go from anywhere. What belongs to one
 * conversation (search, creating a group, the list) and the notifications bell
 * stay in the conversations sidebar beside it. Settings, and the administration inside it, are
 * reached from the user dock laid over its bottom. On a narrow screen the same rail is drawn
 * inside the navigation sheet, so nothing here is reachable only on desktop. */
export function AppNavigationRail({ className }: {
  className?: string;
}) {
  const { pendingIncomingCount } = useFriends();
  const { pathname } = useContentLocation();
  const { isMobile, isOverlay, open: listOpen, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const afterNavigate = () => { if (isOverlay) setOpenMobile(false); };
  // as a drawer the list is opened from here; as a column it can be hidden from its own header, so this is only the way back
  // (on a phone the rail already sits inside that drawer, so the button would only close it)
  const showListToggle = isOverlay ? !isMobile : !listOpen;
  const listExpanded = isOverlay ? openMobile : listOpen;
  // the bell lives in the list's header, so it moves here only while that header is off screen
  const showBell = !isMobile && !listExpanded;
  const friendsLabel = pendingIncomingCount > 0 ? `Amigos, ${pendingIncomingCount} aguardando resposta` : 'Amigos';
  const indicatorId = useId();
  const indicators: RailIndicatorIds = { wash: `${indicatorId}-wash`, marker: `${indicatorId}-marker` };

  return (
    <nav aria-label="Navegação principal" className={cn('flex w-16 flex-none flex-col items-center gap-1.5 border-r border-border-subtle bg-surface-rail pt-3 pb-[max(0.75rem,var(--dock-clearance,0px))]', className)}>
      <RailSlot show={showListToggle}>
        <Tooltip>
          <TooltipTrigger
            onClick={toggleSidebar}
            aria-label="Mostrar lista de conversas"
            aria-expanded={listExpanded}
            className={cn(itemClass, stateClass(false))}
          >
            <SidebarSimpleIcon size={24} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">Mostrar lista de conversas</TooltipContent>
        </Tooltip>
      </RailSlot>
      <RailLink to={ROUTES.conversations} label="Conversas" active={isConversationsPath(pathname)} onNavigate={afterNavigate} indicators={indicators}>
        <ChatCircleIcon size={24} weight={iconWeight(isConversationsPath(pathname))} aria-hidden />
      </RailLink>
      <RailLink to={ROUTES.friends} label={friendsLabel} active={pathname === ROUTES.friends} badge={pendingIncomingCount} onNavigate={afterNavigate} indicators={indicators}>
        <UsersIcon size={24} weight={iconWeight(pathname === ROUTES.friends)} aria-hidden />
      </RailLink>
      <RailSlot show={showBell}>
        <NotificationBell collapsed onNavigate={afterNavigate} />
      </RailSlot>

    </nav>
  );
}
