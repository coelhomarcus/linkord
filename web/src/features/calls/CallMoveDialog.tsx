import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { conversationTitle } from '@/features/conversations/conversationUtils';
import { useRoom } from '@/state/RoomContext';

/** Asked before this tab takes the account's call from another tab or device: that one leaves it. */
export function CallMoveDialog() {
  const { t } = useTranslation('calls');
  const { callMove, callElsewhere, conversations, allUsers, state } = useRoom();
  const conversation = callElsewhere ? conversations.find((c) => c.id === callElsewhere.conversationId) : undefined;
  const name = conversation ? conversationTitle(conversation, state.me.userId, allUsers) : '';
  const description = !callElsewhere || !name
    ? t('move.descriptionUnknown')
    : t(callElsewhere.kind === 'direct' ? 'move.descriptionDirect' : 'move.descriptionVoice', { name });

  return (
    <ConfirmDialog
      open={callMove.open}
      onOpenChange={(open) => { if (!open) callMove.cancel(); }}
      title={t('move.title')}
      description={description}
      confirmLabel={t('move.confirm')}
      onConfirm={callMove.confirm}
    />
  );
}
