import { ChatCircleIcon, ChatsCircleIcon, UsersIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useContentLocation } from '@/shared/lib/contentLocation';
import { ROUTES, isConversationsPath } from '@/shared/lib/routes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { useRoom } from '@/state/RoomContext';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { NotificationBell } from '@/features/notifications/NotificationBell';

/** How many of a group's members are online right now, you included. */
function onlineMembers(memberIds: string[], meUserId: string | null, onlineUserIds: Set<string>): number {
  return memberIds.filter((id) => id === meUserId || onlineUserIds.has(id)).length;
}

/** The bar across the top of the app, from 768px: it names the page you are
 * on (the one behind a settings modal, when one is open), shows who is online
 * in a group, and holds the notifications. On a phone the conversation list's
 * header carries the notifications instead. */
export function AppTopBar() {
  const { pathname } = useContentLocation();
  const { conversations, activeConversationId, onlineUserIds, state } = useRoom();
  const active = isConversationsPath(pathname) ? conversations.find((c) => c.id === activeConversationId) ?? null : null;

  let title: ReactNode;
  let extra: ReactNode = null;
  if (pathname === ROUTES.friends) {
    title = <><UsersIcon size={16} weight="fill" aria-hidden />Amigos</>;
  } else if (active?.type === 'group') {
    title = <><GroupAvatar title={active.title} avatar={active.avatar} size={18} className="border-0 text-[7px]" />{active.title}</>;
    const online = onlineMembers(active.memberIds, state.me.userId, onlineUserIds);
    const label = `${online} ${online === 1 ? 'membro online' : 'membros online'}`;
    extra = (
      <Tooltip>
        <TooltipTrigger render={<span tabIndex={0} aria-label={label} className="flex h-7 items-center gap-1 rounded-md px-1.5 text-label font-medium text-text-secondary" />}>
          <span className="relative">
            <UsersIcon size={18} aria-hidden />
            <span aria-hidden className="absolute -bottom-px -right-px size-2 rounded-full border border-surface-app bg-green" />
          </span>
          {online}
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    );
  } else if (active?.type === 'direct') {
    title = <><ChatCircleIcon size={16} weight="fill" aria-hidden />Mensagens diretas</>;
  } else {
    title = <><ChatsCircleIcon size={16} weight="fill" aria-hidden />Conversas</>;
  }

  return (
    <header className="relative hidden h-9 flex-none items-center justify-end gap-1 px-2 md:flex">
      {/* centered on the window, not on what is left of it beside the buttons */}
      <p className="pointer-events-none absolute inset-x-0 mx-auto flex w-fit max-w-[50%] items-center gap-2 truncate text-label font-medium text-text-secondary [&>svg]:flex-none [&>svg]:text-text-muted">
        {title}
      </p>
      {extra}
      <NotificationBell placement="topbar" />
    </header>
  );
}
