import { ChecksIcon, UserIcon, XIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { NotificationMenuItems } from '@/features/notifications/NotificationMenuItems';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/shared/ui/primitives/dropdown-menu';
import { useRoom } from '@/state/RoomContext';

export function DirectMenuItems({ id, onOpenProfile, onClose }: {
  id: string; onOpenProfile?: () => void; onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const { unreadByConversation, unreadStartByConversation, markConversationRead } = useRoom('unreadByConversation', 'unreadStartByConversation', 'markConversationRead');
  return (
    <>
      {onOpenProfile && (
        <>
          <DropdownMenuItem onClick={onOpenProfile}><UserIcon size={16} />{t('contextMenu.viewProfile')}</DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem disabled={!unreadByConversation.get(id) && !unreadStartByConversation.has(id)} onClick={() => markConversationRead(id)}>
        <ChecksIcon size={16} />{t('contextMenu.markAsRead')}
      </DropdownMenuItem>
      <NotificationMenuItems target={{ scope: 'conversation', id, serverId: null }} />
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onClose}><XIcon size={16} />{t('contextMenu.closeConversation')}</DropdownMenuItem>
    </>
  );
}
