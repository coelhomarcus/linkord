import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { useRoom } from '@/state/RoomContext';

/** A deleted message is gone for everyone with no undo, so every delete entry
 * point asks first. Shift held while clicking skips the question — the way
 * out for someone clearing several messages in a row. */
export function useMessageDeleteConfirm({ onConfirmed }: { onConfirmed?: () => void } = {}) {
  const { t } = useTranslation('chat');
  const { deleteChatMessage } = useRoom();
  // kept after closing so the text doesn't change while the dialog fades out
  const [target, setTarget] = useState<{ msgId: number; shiftHint: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  function requestDelete(msgId: number, skipConfirm = false) {
    if (skipConfirm) { void deleteChatMessage(msgId); return; }
    // read once on open rather than subscribing: every message row owns one of these
    const shiftHint = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
    setTarget({ msgId, shiftHint });
    setOpen(true);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={t('deleteConfirm.title')}
      description={target?.shiftHint
        ? t('deleteConfirm.descriptionShift')
        : t('deleteConfirm.description')}
      confirmLabel={t('deleteConfirm.confirm')}
      destructive
      onConfirm={() => {
        if (target) void deleteChatMessage(target.msgId);
        onConfirmed?.();
      }}
    />
  );

  return { requestDelete, confirmDialog };
}
