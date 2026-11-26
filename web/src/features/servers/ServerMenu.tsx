import { ChecksIcon, FolderPlusIcon, GearSixIcon, PlusCircleIcon, SignOutIcon, UserPlusIcon } from '@/shared/ui/icons';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/shared/ui/primitives/dropdown-menu';
import { NotificationMenuItems } from '@/features/notifications/NotificationMenuItems';
import { ROUTES, serverIdFromPath } from '@/shared/lib/routes';
import { useContentLocation } from '@/shared/lib/contentLocation';
import type { ServerSummary } from '@/shared/types/protocol';
import { useRoom, useRoomState } from '@/state/RoomContext';
import { CreateChannelDialog, type CreateTarget } from './CreateChannelDialog';
import { ServerInviteDialog } from './ServerInviteDialog';
import { useServerSettings } from './ServerSettingsContext';
import { can, canOpenSettings, serverUnread } from './serverUtils';
import { PERMISSIONS } from './permissionBits';
import { leaveServer } from './serversApi';

export type ServerMenuAction = { kind: 'invite'; channelId?: string } | { kind: 'create'; target: CreateTarget } | { kind: 'leave' };

export function ServerMenuItems({ server, onAction, orderActions }: {
  server: ServerSummary; onAction: (action: ServerMenuAction) => void; orderActions?: ReactNode;
}) {
  const { t } = useTranslation('servers');
  const { unreadByConversation, unreadStartByConversation, markServerRead } = useRoom('unreadByConversation', 'unreadStartByConversation', 'markServerRead');
  const { me } = useRoomState('me');
  const { openServerSettings } = useServerSettings();
  const hasUnread = serverUnread(server, unreadByConversation) > 0 || server.channels.some((channel) => unreadStartByConversation.has(channel.id));
  const canManage = server.status !== 'suspended' && can(server, PERMISSIONS.MANAGE_CHANNELS);
  const canInvite = can(server, PERMISSIONS.CREATE_INVITE);
  const canSettings = canOpenSettings(server, me.userId);

  return (
    <>
      <DropdownMenuItem disabled={!hasUnread} onClick={() => markServerRead(server.id)}><ChecksIcon size={18} />{t('menu.markAsRead')}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <NotificationMenuItems target={{ scope: 'server', id: server.id }} />
      {(canInvite || canSettings || canManage) && (
        <>
          <DropdownMenuSeparator />
          {canInvite && <DropdownMenuItem onClick={() => onAction({ kind: 'invite' })}><UserPlusIcon size={18} />{t('menu.invite')}</DropdownMenuItem>}
          {canSettings && <DropdownMenuItem onClick={() => openServerSettings(server.id)}><GearSixIcon size={18} />{t('menu.settings')}</DropdownMenuItem>}
          {canManage && <DropdownMenuItem onClick={() => onAction({ kind: 'create', target: { kind: 'channel', categoryId: null } })}><PlusCircleIcon size={18} />{t('menu.createChannel')}</DropdownMenuItem>}
          {canManage && <DropdownMenuItem onClick={() => onAction({ kind: 'create', target: { kind: 'category' } })}><FolderPlusIcon size={18} />{t('menu.createCategory')}</DropdownMenuItem>}
        </>
      )}
      {orderActions && <><DropdownMenuSeparator />{orderActions}</>}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onClick={() => onAction({ kind: 'leave' })}><SignOutIcon size={18} />{t('menu.leave')}</DropdownMenuItem>
    </>
  );
}

export function ServerActionDialog({ server, action, onClose }: {
  server: ServerSummary; action: ServerMenuAction; onClose: () => void;
}) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const { pathname } = useContentLocation();

  if (action.kind === 'invite') {
    return <ServerInviteDialog server={server} channelId={action.channelId} open onOpenChange={(open) => { if (!open) onClose(); }} />;
  }
  if (action.kind === 'create') {
    return <CreateChannelDialog server={server} target={action.target} onClose={onClose} />;
  }
  return (
    <ConfirmDialog open onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('leave.title', { name: server.name })} description={t('leave.description')}
      confirmLabel={t('leave.confirm')} destructive
      onConfirmAsync={async () => {
        await leaveServer(server.id);
        if (serverIdFromPath(pathname) === server.id) navigate(ROUTES.home);
      }}
    />
  );
}
