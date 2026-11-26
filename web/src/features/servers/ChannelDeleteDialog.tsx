import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import type { ChannelSummary } from '@/shared/types/protocol';
import { deleteChannel } from './serversApi';

export function ChannelDeleteDialog({ channel, onClose, onDeleted }: {
  channel: ChannelSummary; onClose: () => void; onDeleted?: () => void;
}) {
  const { t } = useTranslation('servers');
  const name = channel.type === 'text' ? `#${channel.name}` : channel.name;
  return (
    <ConfirmDialog open onOpenChange={(open) => { if (!open) onClose(); }}
      title={t('deleteChannel.dialogTitle', { name })}
      description={t('deleteChannel.dialogDescription', { name })}
      destructive confirmLabel={t('channelSettings.delete')}
      onConfirmAsync={async () => { await deleteChannel(channel.id); onDeleted?.(); }}
    />
  );
}
