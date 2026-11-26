import { ArrowDownIcon, ArrowUpIcon, BellSlashIcon, CaretDownIcon, CaretRightIcon, ChecksIcon, GearSixIcon, LinkIcon, PencilSimpleIcon, PlusIcon, TrashIcon, UserPlusIcon } from '@/shared/ui/icons';
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { RowMenu, RowMenuButton } from '@/shared/RowMenu';
import { useRowMenu } from '@/shared/hooks/useRowMenu';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { ActiveFill } from '@/shared/ui/active-fill';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Button } from '@/shared/ui/primitives/button';
import { ErrorBanner } from '@/shared/ErrorBanner';
import { EmptyState } from '@/shared/ui/empty-state';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { getPreference, setPreference, usePreferenceValue } from '@/shared/preferences/accountPreferences';
import type { CategorySummary, ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { PERMISSIONS } from './permissionBits';
import { can, canInChannel, canMoveInto, channelSettingsTabs } from './serverUtils';
import { CategoryActionDialog } from './CategoryActionDialog';
import { ChannelDeleteDialog } from './ChannelDeleteDialog';
import { ServerActionDialog, ServerMenuItems, type ServerMenuAction } from './ServerMenu';
import { ChannelGlyph } from './ChannelGlyph';
import { useServerSettings } from './ServerSettingsContext';
import { NotificationMenuItems } from '@/features/notifications/NotificationMenuItems';
import { useChannelLayout } from './useChannelLayout';
import { VoiceMembers, type VoiceDrag } from './VoiceMembers';

const NO_CATEGORIES: readonly string[] = [];

/** The categories this account folded in one server, the same on every device. */
function useCollapsedCategories(serverId: string): readonly string[] {
  return usePreferenceValue(() => {
    const ids = getPreference(`collapsed:${serverId}`);
    return Array.isArray(ids) ? ids : NO_CATEGORIES;
  });
}

function ChannelRow({ server, channel, active, onOpen, onInvite, onDelete, onOpenProfile, onNavigate, drag, onDragChange, layout }: {
  server: ServerSummary; channel: ChannelSummary; active: boolean; onOpen: () => void; onInvite: () => void; onDelete: () => void;
  onOpenProfile: (userId: string) => void; onNavigate?: () => void; drag: VoiceDrag | null; onDragChange: (drag: VoiceDrag | null) => void;
  layout: ReturnType<typeof useChannelLayout>;
}) {
  const { t } = useTranslation('servers');
  const { t: tn } = useTranslation('notifications');
  const { t: tc } = useTranslation('common');
  const { badgeByConversation, mentionsByConversation, notificationPolicyFor, moveToCall, unreadByConversation, unreadStartByConversation, markConversationRead } = useRoom(
    'badgeByConversation', 'mentionsByConversation', 'notificationPolicyFor', 'moveToCall', 'unreadByConversation', 'unreadStartByConversation', 'markConversationRead',
  );
  const state = useRoomState('me');
  const { openChannelSettings } = useServerSettings();
  const [dropping, setDropping] = useState(false);
  const menu = useRowMenu();
  const canInvite = can(server, PERMISSIONS.CREATE_INVITE);
  const canMove = layout.canMove(channel);
  const { previous, next } = canMove ? layout.neighbors(channel) : {};
  const dragProps = layout.dragProps(channel);
  const moveTargets = server.categories.filter((category) => category.id !== channel.categoryId).sort((a, b) => a.position - b.position);
  const canEdit = channelSettingsTabs(server, channel).length > 0;
  const canDelete = canInChannel(channel, PERMISSIONS.MANAGE_CHANNELS);
  const edit = () => openChannelSettings(server.id, channel.id);
  const unread = channel.type === 'text' ? badgeByConversation.get(channel.id) ?? 0 : 0;
  const mentions = channel.type === 'text' ? mentionsByConversation.get(channel.id) ?? 0 : 0;
  // a muted channel reads as quiet: dimmed, its own unread hidden (only mentions still count)
  const muted = channel.type === 'text' && notificationPolicyFor({ id: channel.id, serverId: server.id }).muted;
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
      <div {...menu.rowProps} {...layout.dropProps({ categoryId: channel.categoryId, channel })} className={cn(
        'group/channel relative isolate mx-2 flex min-h-row-channel items-center rounded-lg',
        active ? 'text-text-primary' : unread ? 'text-text-primary' : 'text-text-muted hover:bg-nav-hover hover:text-text-primary',
        muted && !active && !unread && 'opacity-60',
        accepts && dropping && 'bg-nav-hover text-text-primary ring-2 ring-ring',
        layout.dragged?.id === channel.id && 'opacity-50',
        'after:pointer-events-none after:absolute after:inset-x-0 after:z-10 after:h-0.5 after:rounded-full after:bg-ring after:opacity-0 data-[channel-drop=before]:after:-top-0.5 data-[channel-drop=after]:after:-bottom-0.5 data-[channel-drop=before]:after:opacity-100 data-[channel-drop=after]:after:opacity-100',
      )}>
        {active && <ActiveFill />}
        {unread > 0 && !active && <span aria-hidden className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-text-primary" />}
        <button {...menu.primaryProps} {...dragProps} type="button" onClick={onOpen} aria-current={active ? 'page' : undefined}
          className={cn('flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded-lg px-2 text-left focus-ring', dragProps.draggable && 'cursor-grab active:cursor-grabbing')}>
          <ChannelGlyph channel={channel} size={20} className={cn('flex-none', active || unread > 0 ? 'text-text-secondary' : 'text-text-muted')} />
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
          {canInvite && (
            <Tooltip>
              <TooltipTrigger onClick={onInvite} aria-label={t('channel.invite')} className="rounded-sm text-text-secondary hover:text-text-primary pointer-coarse:p-2"><UserPlusIcon size={16} weight="fill" /></TooltipTrigger>
              <TooltipContent>{t('channel.invite')}</TooltipContent>
            </Tooltip>
          )}
          {canEdit && (
            <Tooltip>
              <TooltipTrigger onClick={edit} aria-label={t('channel.edit')} className="rounded-sm text-text-secondary hover:text-text-primary pointer-coarse:p-2"><GearSixIcon size={16} weight="fill" /></TooltipTrigger>
              <TooltipContent>{t('channel.edit')}</TooltipContent>
            </Tooltip>
          )}
          <RowMenuButton menu={menu} name={channel.name} className="size-6 pointer-coarse:size-8" />
        </span>
        <RowMenu menu={menu}>
          {channel.type === 'text' && (
            <>
              <DropdownMenuItem disabled={!unreadByConversation.get(channel.id) && !unreadStartByConversation.has(channel.id)} onClick={() => markConversationRead(channel.id)}>
                <ChecksIcon size={16} />{tc('contextMenu.markAsRead')}
              </DropdownMenuItem>
              <NotificationMenuItems target={{ scope: 'conversation', id: channel.id, serverId: server.id }} />
              <DropdownMenuSeparator />
            </>
          )}
          {canInvite && <DropdownMenuItem onClick={onInvite}><UserPlusIcon size={16} />{t('channel.invite')}</DropdownMenuItem>}
          {canEdit && <DropdownMenuItem onClick={edit}><GearSixIcon size={16} />{t('channel.edit')}</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => void copyToClipboard(new URL(ROUTES.channel(server.id, channel.id), window.location.origin).href)}>
            <LinkIcon size={16} />{t('channel.copyLink')}
          </DropdownMenuItem>
          {canMove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!previous || layout.saving} onClick={() => {
                if (previous) void layout.move(channel, { categoryId: channel.categoryId, target: { channelId: previous.id, edge: 'before' } });
              }}><ArrowUpIcon size={16} />{t('menu.moveUp')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!next || layout.saving} onClick={() => {
                if (next) void layout.move(channel, { categoryId: channel.categoryId, target: { channelId: next.id, edge: 'after' } });
              }}><ArrowDownIcon size={16} />{t('menu.moveDown')}</DropdownMenuItem>
              {(moveTargets.length > 0 || channel.categoryId !== null) && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={layout.saving}>{t('channelLayout.moveTo')}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {channel.categoryId !== null && (
                      <DropdownMenuItem onClick={() => void layout.move(channel, { categoryId: null })}>{t('channelLayout.uncategorized')}</DropdownMenuItem>
                    )}
                    {moveTargets.map((category) => (
                      <DropdownMenuItem key={category.id} onClick={() => void layout.move(channel, { categoryId: category.id })}>{category.name}</DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </>
          )}
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}><TrashIcon size={16} />{t('channelSettings.delete')}</DropdownMenuItem>
            </>
          )}
        </RowMenu>
      </div>
      {channel.type === 'voice' && <VoiceMembers server={server} channel={channel} onOpenProfile={onOpenProfile} onNavigate={onNavigate} drag={drag} onDragChange={onDragChange} />}
    </li>
  );
}

function CategoryHeader({ category, collapsed, canManage, onToggle, onCreate, onRename, onDelete, dropProps }: {
  category: CategorySummary; collapsed: boolean; canManage: boolean;
  onToggle: () => void; onCreate: () => void; onRename: () => void; onDelete: () => void;
  dropProps: ReturnType<ReturnType<typeof useChannelLayout>['dropProps']>;
}) {
  const { t } = useTranslation('servers');
  const menu = useRowMenu();
  const Caret = collapsed ? CaretRightIcon : CaretDownIcon;

  return (
    <div {...menu.rowProps} {...dropProps} className="group/category mx-2 mb-1 flex h-6 items-center rounded-sm px-2 data-[channel-drop=category]:bg-nav-hover data-[channel-drop=category]:ring-2 data-[channel-drop=category]:ring-ring">
      <button {...menu.primaryProps} type="button" onClick={onToggle} aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left text-label font-medium text-text-muted focus-ring hover:text-text-primary">
        <span className="truncate">{category.name}</span>
        <Caret size={12} weight="fill" className="flex-none" />
      </button>
      {canManage && (
        <Tooltip>
          <TooltipTrigger onClick={onCreate} aria-label={t('channel.create')} className="text-text-secondary hover:text-text-primary"><PlusIcon size={18} /></TooltipTrigger>
          <TooltipContent>{t('channel.create')}</TooltipContent>
        </Tooltip>
      )}
      <RowMenuButton menu={menu} name={category.name} className="ml-1 size-6" />
      <RowMenu menu={menu}>
        <DropdownMenuItem onClick={onToggle}><Caret size={16} />{t(collapsed ? 'category.expand' : 'category.collapse')}</DropdownMenuItem>
        {canManage && (
          <>
            <DropdownMenuItem onClick={onCreate}><PlusIcon size={16} />{t('channel.create')}</DropdownMenuItem>
            <DropdownMenuItem onClick={onRename}><PencilSimpleIcon size={16} />{t('category.rename')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}><TrashIcon size={16} />{t('category.delete')}</DropdownMenuItem>
          </>
        )}
      </RowMenu>
    </div>
  );
}

/** A server's column: its name and menu on top, then its channels by
 * category, with who is in each voice channel listed under it. */
export function ChannelList({ server, activeChannelId, onNavigate, onOpenProfile }: {
  server: ServerSummary; activeChannelId: string | null; onNavigate?: () => void; onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('servers');
  const layout = useChannelLayout(server);
  const navigate = useNavigate();
  const { openCall, activeCallConversationId } = useRoom('openCall', 'activeCallConversationId');
  const collapsedIds = useCollapsedCategories(server.id);
  const collapsed = new Set(collapsedIds);
  const [serverAction, setServerAction] = useState<ServerMenuAction | null>(null);
  const [categoryAction, setCategoryAction] = useState<{ id: string; kind: 'rename' | 'delete' } | null>(null);
  const [deleteChannelId, setDeleteChannelId] = useState<string | null>(null);
  const [drag, setDrag] = useState<VoiceDrag | null>(null);
  const canManageChannels = can(server, PERMISSIONS.MANAGE_CHANNELS);
  const actionCategory = server.categories.find((category) => category.id === categoryAction?.id);
  const channelToDelete = server.channels.find((channel) => channel.id === deleteChannelId);

  function createChannelIn(categoryId: string | null) {
    setServerAction({ kind: 'create', target: { kind: 'channel', categoryId } });
  }

  // the menu opens centred under the whole header, as Discord's does, not under the name
  const headerRef = useRef<HTMLDivElement | null>(null);

  function toggleCategory(id: string) {
    const next = collapsedIds.includes(id) ? collapsedIds.filter((c) => c !== id) : [...collapsedIds, id];
    setPreference(`collapsed:${server.id}`, next.length > 0 ? next : null);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={headerRef} className="flex h-header flex-none items-center gap-2 border-b border-border-subtle px-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="group/server-menu flex h-8 min-w-0 items-center gap-1 rounded-lg px-2 text-left text-text-primary hover:bg-nav-hover aria-expanded:bg-nav-hover">
            <span className="min-w-0 truncate text-body font-semibold">{server.name}</span>
            <CaretDownIcon size={14} weight="fill" className="flex-none transition-transform group-aria-expanded/server-menu:rotate-180" />
          </DropdownMenuTrigger>
          <DropdownMenuContent anchor={headerRef} align="center" sideOffset={-6} className="min-w-[220px]">
            <ServerMenuItems server={server} onAction={setServerAction} />
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {layout.dragged && (
          <div {...layout.dropProps({ categoryId: null })} className="flex h-7 flex-none items-center rounded-sm border border-dashed border-border-strong px-2 text-label text-text-muted data-[channel-drop=category]:bg-nav-hover data-[channel-drop=category]:text-text-primary data-[channel-drop=category]:ring-2 data-[channel-drop=category]:ring-ring">
            {t('channelLayout.uncategorized')}
          </div>
        )}
        {can(server, PERMISSIONS.CREATE_INVITE) && (
          <Tooltip>
            <TooltipTrigger onClick={() => setServerAction({ kind: 'invite' })} aria-label={t('menu.invite')} className="grid size-8 flex-none place-items-center rounded-lg text-text-secondary hover:bg-nav-hover hover:text-text-primary">
              <UserPlusIcon size={20} weight="fill" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('menu.invite')}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {layout.error && <div role="alert" className="px-3 pt-2"><ErrorBanner>{layout.error}</ErrorBanner></div>}
      {server.status === 'suspended' ? (
        <p className="px-4 py-8 text-center text-label text-text-muted">{t('suspended')}</p>
      ) : (
        <nav aria-label={t('channels')} className="min-h-0 flex-1 overflow-y-auto pb-[max(0.75rem,var(--dock-list-clearance,0px))] pt-4">
          {layout.groups.map(({ category, channels }) => {
            const isCollapsed = !!category && collapsed.has(category.id);
            const shown = isCollapsed ? channels.filter((c) => c.id === activeChannelId || c.id === activeCallConversationId) : channels;
            return (
              <section key={category?.id ?? 'loose'} className="mb-4">
                {category && (
                  <CategoryHeader category={category} collapsed={isCollapsed} canManage={canManageChannels} dropProps={layout.dropProps({ categoryId: category.id })}
                    onToggle={() => toggleCategory(category.id)} onCreate={() => createChannelIn(category.id)}
                    onRename={() => setCategoryAction({ id: category.id, kind: 'rename' })}
                    onDelete={() => setCategoryAction({ id: category.id, kind: 'delete' })} />
                )}
                <ul className="flex flex-col gap-0.5">
                  {shown.map((channel) => (
                    <ChannelRow key={channel.id} server={server} channel={channel} active={channel.id === activeChannelId}
                      onOpen={() => open(channel)} onInvite={() => setServerAction({ kind: 'invite', channelId: channel.id })}
                      onDelete={() => setDeleteChannelId(channel.id)}
                      onOpenProfile={onOpenProfile} onNavigate={onNavigate} drag={drag} onDragChange={setDrag} layout={layout} />
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
                <Button type="button" variant="secondary" size="sm" onClick={() => createChannelIn(null)}>
                  <PlusIcon size={16} aria-hidden />{t('menu.createChannel')}
                </Button>
              )}
            />
          )}
        </nav>
      )}

      {serverAction && <ServerActionDialog key={server.id} server={server} action={serverAction} onClose={() => setServerAction(null)} />}
      {categoryAction && actionCategory && canManageChannels && server.status !== 'suspended' && (
        <CategoryActionDialog key={actionCategory.id} category={actionCategory} action={categoryAction.kind} onClose={() => setCategoryAction(null)} />
      )}
      {channelToDelete && canInChannel(channelToDelete, PERMISSIONS.MANAGE_CHANNELS) && server.status !== 'suspended' && (
        <ChannelDeleteDialog key={channelToDelete.id} channel={channelToDelete} onClose={() => setDeleteChannelId(null)} />
      )}
    </div>
  );
}
