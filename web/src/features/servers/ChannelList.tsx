import {
  BellSlashIcon, CaretDownIcon, CaretRightIcon, ChecksIcon, FolderPlusIcon, GearSixIcon, HashIcon, PlusCircleIcon, PlusIcon, SignOutIcon,
  SpeakerHighIcon, UserPlusIcon,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { ActiveFill } from '@/shared/ui/active-fill';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import type { ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { PERMISSIONS } from './permissionBits';
import { CreateChannelDialog, type CreateTarget } from './CreateChannelDialog';
import { ServerInviteDialog } from './ServerInviteDialog';
import { leaveServer } from './serversApi';
import { can, canMoveInto, canOpenSettings, channelSettingsTabs, groupChannels, serverUnread } from './serverUtils';
import { useServerSettings } from './ServerSettingsContext';
import { NotificationMenuItems } from '@/features/notifications/NotificationMenuItems';
import { VoiceMembers, type VoiceDrag } from './VoiceMembers';

function loadCollapsed(serverId: string): Set<string> {
  try { return new Set(JSON.parse(localStorageStore.get(LOCAL_STORAGE_KEYS.collapsedCategories(serverId)) ?? '[]') as string[]); } catch { return new Set(); }
}

function ChannelRow({ server, channel, active, onOpen, onInvite, onOpenProfile, drag, onDragChange }: {
  server: ServerSummary; channel: ChannelSummary; active: boolean; onOpen: () => void; onInvite: () => void;
  onOpenProfile: (userId: string) => void; drag: VoiceDrag | null; onDragChange: (drag: VoiceDrag | null) => void;
}) {
  const { t } = useTranslation('servers');
  const { t: tn } = useTranslation('notifications');
  const { state, badgeByConversation, mentionsByConversation, notificationPolicyFor, moveToCall } = useRoom();
  const { openChannelSettings } = useServerSettings();
  const [dropping, setDropping] = useState(false);
  const unread = channel.type === 'text' ? badgeByConversation.get(channel.id) ?? 0 : 0;
  const mentions = channel.type === 'text' ? mentionsByConversation.get(channel.id) ?? 0 : 0;
  // a muted channel reads as quiet: dimmed, its own unread hidden (only mentions still count)
  const muted = channel.type === 'text' && notificationPolicyFor({ id: channel.id, serverId: server.id }).muted;
  const Icon = channel.type === 'voice' ? SpeakerHighIcon : HashIcon;
  // someone dragged out of another voice channel can land in this one
  const accepts = channel.type === 'voice' && !!drag && drag.fromChannelId !== channel.id && canMoveInto(channel, state.me.role === 'admin');
  const dropHandlers = accepts ? {
    onDragOver: (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropping(true); },
    onDragLeave: (event: DragEvent) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDropping(false);
      moveToCall(drag.participantId, channel.id);
      onDragChange(null);
    },
  } : {};
  return (
    <li data-channel-id={channel.id} data-drop-target={accepts && dropping ? '' : undefined} {...dropHandlers}>
      {/* a text channel's row opens the conversation menu (mark as read), on a long press too */}
      <div data-conversation-id={channel.type === 'text' ? channel.id : undefined} className={cn(
        'group/channel relative isolate mx-2 flex h-8 items-center rounded-lg',
        active ? 'text-text-primary' : unread ? 'text-text-primary' : 'text-text-muted hover:bg-nav-hover hover:text-text-primary',
        muted && !active && !unread && 'opacity-60',
        accepts && dropping && 'bg-nav-hover text-text-primary ring-2 ring-ring',
      )}>
        {active && <ActiveFill />}
        {unread > 0 && !active && <span aria-hidden className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary" />}
        <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined} className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left">
          <Icon size={20} className={cn('flex-none', active || unread > 0 ? 'text-text-secondary' : 'text-text-muted')} />
          <span className={cn('truncate text-body', unread > 0 ? 'font-semibold' : 'font-medium')}>{channel.name}</span>
          {muted && <BellSlashIcon size={14} className="flex-none text-text-muted" aria-label={tn('preferences.muted')} role="img" />}
          {mentions > 0 && !active && (
            <span className="ml-auto flex-none rounded-full bg-red px-1.5 text-label font-semibold text-white">
              <span aria-hidden>{mentions}</span>
              <span className="sr-only">{tn('preferences.mentionCount', { count: mentions })}</span>
            </span>
          )}
        </button>
        <span className={cn('flex flex-none items-center gap-1 pr-2', active ? 'flex' : 'hidden group-hover/channel:flex group-focus-within/channel:flex [@media(hover:none)]:flex')}>
          {can(server, PERMISSIONS.CREATE_INVITE) && (
            <Tooltip>
              <TooltipTrigger onClick={onInvite} aria-label={t('channel.invite')} className="rounded-sm text-text-secondary hover:text-text-primary pointer-coarse:p-2"><UserPlusIcon size={16} weight="fill" /></TooltipTrigger>
              <TooltipContent>{t('channel.invite')}</TooltipContent>
            </Tooltip>
          )}
          {channelSettingsTabs(server, channel).length > 0 && (
            <Tooltip>
              <TooltipTrigger onClick={() => openChannelSettings(server.id, channel.id)} aria-label={t('channel.edit')} className="rounded-sm text-text-secondary hover:text-text-primary pointer-coarse:p-2"><GearSixIcon size={16} weight="fill" /></TooltipTrigger>
              <TooltipContent>{t('channel.edit')}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>
      {channel.type === 'voice' && <VoiceMembers server={server} channel={channel} onOpenProfile={onOpenProfile} drag={drag} onDragChange={onDragChange} />}
    </li>
  );
}

/** A server's column: its name and menu on top, then its channels by
 * category, with who is in each voice channel listed under it. */
export function ChannelList({ server, activeChannelId, onNavigate, onOpenProfile }: {
  server: ServerSummary; activeChannelId: string | null; onNavigate?: () => void; onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { state, openCall, activeCallConversationId, unreadByConversation, unreadStartByConversation, markServerRead } = useRoom();
  const { openServerSettings } = useServerSettings();
  const hasUnread = serverUnread(server, unreadByConversation) > 0 || server.channels.some((c) => unreadStartByConversation.has(c.id));
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(server.id));
  const [inviteOpen, setInviteOpen] = useState<{ channelId?: string } | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [drag, setDrag] = useState<VoiceDrag | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const canManageChannels = can(server, PERMISSIONS.MANAGE_CHANNELS);
  // the menu opens centred under the whole header, as Discord's does, not under the name
  const headerRef = useRef<HTMLDivElement | null>(null);

  function toggleCategory(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorageStore.set(LOCAL_STORAGE_KEYS.collapsedCategories(server.id), JSON.stringify([...next]));
      return next;
    });
  }

  function open(channel: ChannelSummary) {
    if (channel.type === 'voice') {
      if (activeCallConversationId === channel.id) navigate(ROUTES.channel(server.id, channel.id));
      else openCall(channel.id);
    } else {
      navigate(ROUTES.channel(server.id, channel.id));
    }
    onNavigate?.();
  }

  async function leave() {
    try {
      await leaveServer(server.id);
      setConfirmLeave(false);
      navigate(ROUTES.home);
    } catch (err) {
      setLeaveError(describeApiError(err));
      setConfirmLeave(true);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={headerRef} className="flex h-header flex-none items-center gap-2 border-b border-border-subtle px-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="group/server-menu flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-left text-text-primary hover:bg-nav-hover aria-expanded:bg-nav-hover">
            <span className="min-w-0 truncate text-body font-semibold">{server.name}</span>
            <CaretDownIcon size={14} weight="bold" className="flex-none transition-transform group-aria-expanded/server-menu:rotate-180" />
          </DropdownMenuTrigger>
          <DropdownMenuContent anchor={headerRef} align="center" sideOffset={-6} className="w-[220px]">
            <DropdownMenuItem disabled={!hasUnread} onClick={() => markServerRead(server.id)}><ChecksIcon size={18} weight="bold" />{t('menu.markAsRead')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <NotificationMenuItems target={{ scope: 'server', id: server.id }} />
            <DropdownMenuSeparator />
            {can(server, PERMISSIONS.CREATE_INVITE) && <DropdownMenuItem onClick={() => setInviteOpen({})}><UserPlusIcon size={18} weight="fill" />{t('menu.invite')}</DropdownMenuItem>}
            {canOpenSettings(server, state.me.userId) && <DropdownMenuItem onClick={() => openServerSettings(server.id)}><GearSixIcon size={18} weight="fill" />{t('menu.settings')}</DropdownMenuItem>}
            {canManageChannels && <DropdownMenuItem onClick={() => setCreateTarget({ kind: 'channel', categoryId: null })}><PlusCircleIcon size={18} weight="fill" />{t('menu.createChannel')}</DropdownMenuItem>}
            {canManageChannels && <DropdownMenuItem onClick={() => setCreateTarget({ kind: 'category' })}><FolderPlusIcon size={18} weight="fill" />{t('menu.createCategory')}</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => { setLeaveError(null); setConfirmLeave(true); }}><SignOutIcon size={18} weight="bold" />{t('menu.leave')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {can(server, PERMISSIONS.CREATE_INVITE) && (
          <Tooltip>
            <TooltipTrigger onClick={() => setInviteOpen({})} aria-label={t('menu.invite')} className="grid size-8 flex-none place-items-center rounded-lg text-text-secondary hover:bg-nav-hover hover:text-text-primary">
              <UserPlusIcon size={20} weight="fill" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('menu.invite')}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {server.status === 'suspended' ? (
        <p className="px-4 py-8 text-center text-label text-text-muted">{t('suspended')}</p>
      ) : (
        <nav aria-label={t('channels')} className="min-h-0 flex-1 overflow-y-auto pb-[max(0.75rem,var(--dock-list-clearance,0px))] pt-4">
          {groupChannels(server).map(({ category, channels }) => {
            const isCollapsed = !!category && collapsed.has(category.id);
            const shown = isCollapsed ? channels.filter((c) => c.id === activeChannelId || c.id === activeCallConversationId) : channels;
            return (
              <section key={category?.id ?? 'loose'} className="mb-4">
                {category && (
                  <div className="group/category flex h-6 items-center pl-4 pr-4 mb-1">
                    <button type="button" onClick={() => toggleCategory(category.id)} aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-label font-medium text-text-muted hover:text-text-primary">
                      <span className="truncate">{category.name}</span>
                      {isCollapsed ? <CaretRightIcon size={12} weight="bold" className="flex-none" /> : <CaretDownIcon size={12} weight="bold" className="flex-none" />}
                    </button>
                    {canManageChannels && (
                      <Tooltip>
                        <TooltipTrigger onClick={() => setCreateTarget({ kind: 'channel', categoryId: category.id })} aria-label={t('channel.create')} className="text-text-secondary hover:text-text-primary"><PlusIcon size={18} /></TooltipTrigger>
                        <TooltipContent>{t('channel.create')}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
                <ul className="flex flex-col gap-0.5">
                  {shown.map((channel) => (
                    <ChannelRow key={channel.id} server={server} channel={channel} active={channel.id === activeChannelId}
                      onOpen={() => open(channel)} onInvite={() => setInviteOpen({ channelId: channel.id })}
                      onOpenProfile={onOpenProfile} drag={drag} onDragChange={setDrag} />
                  ))}
                </ul>
              </section>
            );
          })}
          {server.channels.length === 0 && (
            <EmptyState
              size="compact"
              illustration="hash"
              title={t('noChannels')}
              description={canManageChannels ? t('noChannelsCanCreate') : t('noChannelsText')}
              action={canManageChannels && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setCreateTarget({ kind: 'channel', categoryId: null })}>
                  <PlusIcon size={16} aria-hidden />{t('menu.createChannel')}
                </Button>
              )}
            />
          )}
        </nav>
      )}

      <ServerInviteDialog server={server} channelId={inviteOpen?.channelId} open={!!inviteOpen} onOpenChange={(next) => { if (!next) setInviteOpen(null); }} />
      <CreateChannelDialog server={server} target={createTarget} onClose={() => setCreateTarget(null)} />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t('leave.title', { name: server.name })}
        description={leaveError ?? t('leave.description')}
        confirmLabel={t('leave.confirm')}
        destructive
        onConfirm={() => void leave()}
      />
    </div>
  );
}
