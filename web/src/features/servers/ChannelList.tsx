import {
  CaretDownIcon, CaretRightIcon, FolderPlusIcon, GearSixIcon, HashIcon, PlusCircleIcon, PlusIcon, SignOutIcon,
  SpeakerHighIcon, UserPlusIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { ActiveFill } from '@/shared/ui/active-fill';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { describeApiError } from '@/shared/api/errorText';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { PERMISSIONS } from './permissionBits';
import { CreateChannelDialog, type CreateTarget } from './CreateChannelDialog';
import { ServerInviteDialog } from './ServerInviteDialog';
import { leaveServer } from './serversApi';
import { can, canInChannel, canOpenSettings, groupChannels } from './serverUtils';
import { useServerSettings } from './ServerSettingsContext';

const COLLAPSED_KEY = (serverId: string) => `ss-collapsed-categories:${serverId}`;

function loadCollapsed(serverId: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY(serverId)) ?? '[]') as string[]); } catch { return new Set(); }
}

function VoiceMembers({ channelId }: { channelId: string }) {
  const { state, activeCallConversationId } = useRoom();
  const others = [...state.participants.values()].filter((p) => p.callConversationId === channelId);
  const people = activeCallConversationId === channelId
    ? [{ id: state.me.id ?? 'me', userId: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarPoster: state.me.avatarPoster, avatarColor: state.me.avatarColor, speaking: false }, ...others]
    : others;
  if (!people.length) return null;
  return (
    <ul className="mb-1 ml-8 flex flex-col">
      {people.map((p) => (
        <li key={p.id} className="flex items-center gap-2 rounded-sm px-2 py-1 text-label text-text-secondary">
          <Avatar id={p.userId} name={p.displayName} avatar={p.avatar} poster={p.avatarPoster} avatarColor={p.avatarColor} size={24}
            className={cn('ring-2', p.speaking ? 'ring-green' : 'ring-transparent')} />
          <span className="truncate">{p.displayName}</span>
        </li>
      ))}
    </ul>
  );
}

function ChannelRow({ server, channel, active, onOpen, onInvite }: {
  server: ServerSummary; channel: ChannelSummary; active: boolean; onOpen: () => void; onInvite: () => void;
}) {
  const { t } = useTranslation('servers');
  const { unreadByConversation } = useRoom();
  const { openChannelSettings } = useServerSettings();
  const unread = channel.type === 'text' ? unreadByConversation.get(channel.id) ?? 0 : 0;
  const Icon = channel.type === 'voice' ? SpeakerHighIcon : HashIcon;
  return (
    <li data-channel-id={channel.id}>
      <div className={cn('group/channel relative isolate mx-2 flex items-center rounded-md', active ? 'text-text-primary' : unread ? 'text-text-primary' : 'text-text-muted hover:bg-nav-hover hover:text-text-secondary')}>
        {active && <ActiveFill />}
        {unread > 0 && !active && <span aria-hidden className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary" />}
        <button type="button" onClick={onOpen} aria-current={active ? 'page' : undefined} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left">
          <Icon size={20} className="flex-none opacity-70" />
          <span className={cn('truncate text-label', unread > 0 || active ? 'font-semibold' : 'font-medium')}>{channel.name}</span>
        </button>
        <span className={cn('flex flex-none items-center gap-0.5 pr-1.5', active ? 'flex' : 'hidden group-hover/channel:flex group-focus-within/channel:flex [@media(hover:none)]:flex')}>
          {can(server, PERMISSIONS.CREATE_INVITE) && (
            <Tooltip>
              <TooltipTrigger onClick={onInvite} aria-label={t('channel.invite')} className="rounded-sm p-0.5 text-text-muted hover:text-text-primary pointer-coarse:p-2"><UserPlusIcon size={16} /></TooltipTrigger>
              <TooltipContent>{t('channel.invite')}</TooltipContent>
            </Tooltip>
          )}
          {canInChannel(channel, PERMISSIONS.MANAGE_CHANNELS) && (
            <Tooltip>
              <TooltipTrigger onClick={() => openChannelSettings(server.id, channel.id)} aria-label={t('channel.edit')} className="rounded-sm p-0.5 text-text-muted hover:text-text-primary pointer-coarse:p-2"><GearSixIcon size={16} /></TooltipTrigger>
              <TooltipContent>{t('channel.edit')}</TooltipContent>
            </Tooltip>
          )}
        </span>
      </div>
      {channel.type === 'voice' && <VoiceMembers channelId={channel.id} />}
    </li>
  );
}

/** A server's column: its name and menu on top, then its channels by
 * category, with who is in each voice channel listed under it. */
export function ChannelList({ server, activeChannelId, onNavigate }: { server: ServerSummary; activeChannelId: string | null; onNavigate?: () => void }) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { openCall, activeCallConversationId } = useRoom();
  const { openServerSettings } = useServerSettings();
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(server.id));
  const [inviteOpen, setInviteOpen] = useState<{ channelId?: string } | null>(null);
  const [createTarget, setCreateTarget] = useState<CreateTarget | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const canManageChannels = can(server, PERMISSIONS.MANAGE_CHANNELS);

  function toggleCategory(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(COLLAPSED_KEY(server.id), JSON.stringify([...next])); } catch { /* storage unavailable */ }
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
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-header flex-none items-center gap-2 border-b border-border-subtle px-4 text-left hover:bg-nav-hover aria-expanded:bg-nav-hover md:mt-[calc(var(--spacing-shell)+1px)]">
          <span className="min-w-0 flex-1 truncate text-title font-semibold">{server.name}</span>
          <CaretDownIcon size={16} weight="bold" className="flex-none" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {can(server, PERMISSIONS.CREATE_INVITE) && <DropdownMenuItem onClick={() => setInviteOpen({})} className="text-accent-text"><UserPlusIcon size={18} />{t('menu.invite')}</DropdownMenuItem>}
          {canOpenSettings(server) && <DropdownMenuItem onClick={() => openServerSettings(server.id)}><GearSixIcon size={18} />{t('menu.settings')}</DropdownMenuItem>}
          {canManageChannels && <DropdownMenuItem onClick={() => setCreateTarget({ kind: 'channel', categoryId: null })}><PlusCircleIcon size={18} />{t('menu.createChannel')}</DropdownMenuItem>}
          {canManageChannels && <DropdownMenuItem onClick={() => setCreateTarget({ kind: 'category' })}><FolderPlusIcon size={18} />{t('menu.createCategory')}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => { setLeaveError(null); setConfirmLeave(true); }}><SignOutIcon size={18} />{t('menu.leave')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {server.status === 'suspended' ? (
        <p className="px-4 py-8 text-center text-label text-text-muted">{t('suspended')}</p>
      ) : (
        <nav aria-label={t('channels')} className="min-h-0 flex-1 overflow-y-auto pb-[max(0.75rem,var(--dock-list-clearance,0px))] pt-3">
          {groupChannels(server).map(({ category, channels }) => {
            const isCollapsed = !!category && collapsed.has(category.id);
            const shown = isCollapsed ? channels.filter((c) => c.id === activeChannelId || c.id === activeCallConversationId) : channels;
            return (
              <section key={category?.id ?? 'loose'} className="mb-3">
                {category && (
                  <div className="group/category flex items-center pr-2">
                    <button type="button" onClick={() => toggleCategory(category.id)} aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-0.5 px-2 py-1 text-left text-caption font-semibold uppercase tracking-wide text-text-muted hover:text-text-secondary">
                      {isCollapsed ? <CaretRightIcon size={12} weight="bold" /> : <CaretDownIcon size={12} weight="bold" />}
                      <span className="truncate">{category.name}</span>
                    </button>
                    {canManageChannels && (
                      <Tooltip>
                        <TooltipTrigger onClick={() => setCreateTarget({ kind: 'channel', categoryId: category.id })} aria-label={t('channel.create')} className="text-text-muted hover:text-text-primary"><PlusIcon size={16} /></TooltipTrigger>
                        <TooltipContent>{t('channel.create')}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
                <ul className="flex flex-col gap-0.5">
                  {shown.map((channel) => (
                    <ChannelRow key={channel.id} server={server} channel={channel} active={channel.id === activeChannelId}
                      onOpen={() => open(channel)} onInvite={() => setInviteOpen({ channelId: channel.id })} />
                  ))}
                </ul>
              </section>
            );
          })}
          {server.channels.length === 0 && <p className="px-4 py-6 text-center text-label text-text-muted">{t('noChannels')}</p>}
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
