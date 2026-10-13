import { Link, useLocation } from 'react-router';
import { Avatar } from '@/shared/Avatar';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, isConversationsPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { useFriends } from '@/features/friends/FriendsContext';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { CountBadge } from '@/shared/CountBadge';
import { useAnimatedIcon, type AnimatedIcon } from '@/shared/ui/icons/useAnimatedIcon';
import { MessageCircleIcon } from '@/shared/ui/icons/message-circle';
import { UsersRoundIcon } from '@/shared/ui/icons/users-round';
import { PhoneCallIcon } from '@/shared/ui/icons/phone-call';
import { PanelLeftOpenIcon } from '@/shared/ui/icons/panel-left-open';
import { ShieldCheckIcon } from '@/shared/ui/icons/shield-check';
import { SettingsIcon } from '@/shared/ui/icons/settings';

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

function RailLink({ to, label, active, badge, onNavigate, icon: Icon }: {
  to: string;
  label: string;
  active: boolean;
  badge?: number;
  onNavigate: () => void;
  icon: AnimatedIcon;
}) {
  const { ref, triggerProps } = useAnimatedIcon();
  return (
    <Tooltip>
      <TooltipTrigger
        {...triggerProps}
        render={<Link to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={label} className={cn(itemClass, stateClass(active))} />}
      >
        {active && <ActiveMarker />}
        <Icon ref={ref} size={20} aria-hidden />
        {!!badge && <RailBadge count={badge} />}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function RailButton({ label, onClick, className, icon: Icon, ...rest }: {
  label: string;
  onClick: () => void;
  className: string;
  icon: AnimatedIcon;
  'aria-expanded'?: boolean;
}) {
  const { ref, triggerProps } = useAnimatedIcon();
  return (
    <Tooltip>
      <TooltipTrigger {...triggerProps} {...rest} onClick={onClick} aria-label={label} className={cn(itemClass, className)}>
        <Icon ref={ref} size={20} aria-hidden />
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The global navigation: where you can go from anywhere. What belongs to one
 * conversation (search, creating a group, the list) stays in the conversations
 * sidebar beside it. On a narrow screen the same rail is drawn inside the
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
  const { isMobile, isOverlay, open: listOpen, openMobile, setOpenMobile, toggleSidebar } = useAnimatedSidebar();
  const afterNavigate = () => { if (isOverlay) setOpenMobile(false); };
  // as a drawer the list is opened from here; as a column it can be hidden from its own header, so this is only the way back
  // (on a phone the rail already sits inside that drawer, so the button would only close it)
  const showListToggle = isOverlay ? !isMobile : !listOpen;
  const listExpanded = isOverlay ? openMobile : listOpen;
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
      <RailLink to={ROUTES.conversations} label="Conversas" active={isConversationsPath(pathname)} onNavigate={afterNavigate} icon={MessageCircleIcon} />
      <RailLink to={ROUTES.friends} label={friendsLabel} active={pathname === ROUTES.friends} badge={pendingIncomingCount} onNavigate={afterNavigate} icon={UsersRoundIcon} />
      <NotificationBell collapsed onNavigate={afterNavigate} />

      {inCall && (
        <RailButton
          label={returnToCallLabel}
          onClick={() => { onReturnToCall?.(); afterNavigate(); }}
          className="text-green hover:bg-green/12"
          icon={PhoneCallIcon}
        />
      )}

      <div className="flex-1" />

      {showListToggle && (
        <RailButton
          label="Mostrar lista de conversas"
          onClick={toggleSidebar}
          aria-expanded={listExpanded}
          className={stateClass(false)}
          icon={PanelLeftOpenIcon}
        />
      )}
      {isAdmin && (
        <RailLink to={ROUTES.admin} label="Área administrativa" active={onAdmin} onNavigate={afterNavigate} icon={ShieldCheckIcon} />
      )}
      <RailLink to={ROUTES.settings} label="Ajustes" active={onSettings} onNavigate={afterNavigate} icon={SettingsIcon} />
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
