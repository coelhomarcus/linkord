import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MessageCircle, PanelLeftOpen, PhoneCall, Settings, ShieldCheck, UsersRound } from '@/shared/ui/icons';
import { Avatar } from '@/shared/Avatar';
import { useSidebar } from '@/shared/ui/motion/sidebar-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, isConversationsPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { useRoom } from '@/state/RoomContext';
import { useFriends } from '@/features/friends/FriendsContext';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { CountBadge } from '@/shared/CountBadge';

const itemClass = 'relative grid size-11 place-items-center rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

function stateClass(active: boolean): string {
  return active ? 'bg-fill-active text-text-primary shadow-highlight' :'text-text-muted hover:bg-fill-hover hover:text-text-primary';
}

/** A short bar on the edge: the selected destination isn't told by colour alone. */
function ActiveMarker() {
  return <span aria-hidden className="absolute -left-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />;
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

function RailLink({ to, label, active, badge, onNavigate, children }: {
  to: string;
  label: string;
  active: boolean;
  badge?: number;
  onNavigate: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={label} className={cn(itemClass, stateClass(active))} />}
      >
        {active && <ActiveMarker />}
        {children}
        {!!badge && <RailBadge count={badge} />}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The global navigation: where you can go from anywhere. What belongs to one
 * conversation (search, creating a group, the list) and the notifications bell
 * stay in the conversations sidebar beside it. On a narrow screen the same rail is drawn inside the
 * navigation sheet, so nothing here is reachable only on desktop. */
export function AppNavigationRail({ onOpenProfile, onReturnToCall, className }: {
  onOpenProfile: (userId: string) => void;
  /** Present whenever a call is running, regardless of which page is open —
   * same "jump back to the Stage" action FloatingPip's own onExpand does. */
  onReturnToCall?: () => void;
  className?: string;
}) {
  const { state, conversations, activeCallConversationId, allUsers } = useRoom();
  const { pendingIncomingCount } = useFriends();
  const { pathname } = useLocation();
  const { isMobile, isOverlay, open: listOpen, openMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const afterNavigate = () => { if (isOverlay) setOpenMobile(false); };
  // as a drawer the list is opened from here; as a column it can be hidden from its own header, so this is only the way back
  // (on a phone the rail already sits inside that drawer, so the button would only close it)
  const showListToggle = isOverlay ? !isMobile : !listOpen;
  const listExpanded = isOverlay ? openMobile : listOpen;
  // the bell lives in the list's header, so it moves here only while that header is off screen
  const showBell = !isMobile && !listExpanded;
  const onSettings = pathname.startsWith(ROUTES.settings);
  const onAdmin = pathname.startsWith('/admin');
  const isAdmin = state.me.role === 'admin';
  const friendsLabel = pendingIncomingCount > 0 ? `Amigos, ${pendingIncomingCount} aguardando resposta` : 'Amigos';
  const inCall = activeCallConversationId !== null;
  const callTitle = inCall
    ? conversationTitle(conversations.find((c) => c.id === activeCallConversationId) ?? null, state.me.userId, allUsers)
    : '';
  const returnToCallLabel = callTitle ? `Voltar para ${callTitle}` : 'Voltar para a chamada';

  return (
    <nav aria-label="Navegação principal" className={cn('flex w-16 flex-none flex-col items-center gap-1.5 border-r border-border-subtle bg-surface-rail py-3', className)}>
      <RailSlot show={showListToggle}>
        <Tooltip>
          <TooltipTrigger
            onClick={toggleSidebar}
            aria-label="Mostrar lista de conversas"
            aria-expanded={listExpanded}
            className={cn(itemClass, stateClass(false))}
          >
            <PanelLeftOpen size={20} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">Mostrar lista de conversas</TooltipContent>
        </Tooltip>
      </RailSlot>
      <RailLink to={ROUTES.conversations} label="Conversas" active={isConversationsPath(pathname)} onNavigate={afterNavigate}>
        <MessageCircle size={20} aria-hidden />
      </RailLink>
      <RailLink to={ROUTES.friends} label={friendsLabel} active={pathname === ROUTES.friends} badge={pendingIncomingCount} onNavigate={afterNavigate}>
        <UsersRound size={20} aria-hidden />
      </RailLink>
      <RailSlot show={showBell}>
        <NotificationBell collapsed onNavigate={afterNavigate} />
      </RailSlot>

      {inCall && (
        <Tooltip>
          <TooltipTrigger
            onClick={() => { onReturnToCall?.(); afterNavigate(); }}
            aria-label={returnToCallLabel}
            className={cn(itemClass, 'text-green hover:bg-green/12')}
          >
            <PhoneCall size={20} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">{returnToCallLabel}</TooltipContent>
        </Tooltip>
      )}

      <div className="flex-1" />

      {isAdmin && (
        <RailLink to={ROUTES.admin} label="Área administrativa" active={onAdmin} onNavigate={afterNavigate}>
          <ShieldCheck size={20} aria-hidden />
        </RailLink>
      )}
      <RailLink to={ROUTES.settings} label="Ajustes" active={onSettings} onNavigate={afterNavigate}>
        <Settings size={20} aria-hidden />
      </RailLink>
      <Tooltip>
        <TooltipTrigger
          onClick={() => { if (state.me.userId) onOpenProfile(state.me.userId); afterNavigate(); }}
          aria-label="Meu perfil"
          className={cn(itemClass, stateClass(false))}
        >
          <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={32} />
        </TooltipTrigger>
        <TooltipContent side="right">Meu perfil</TooltipContent>
      </Tooltip>
    </nav>
  );
}
