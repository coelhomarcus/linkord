import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { ConfirmDialog } from '@/shared/ConfirmDialog';
import { useRoom } from '@/state/RoomContext';

/** A pin is seen by everyone in the conversation, and an unpin takes it from
 * everyone, so both ask first. Shift held while clicking skips the question,
 * as it does for deleting. */
export function useMessagePinConfirm({ onDone }: { onDone?: (ok: boolean) => void } = {}) {
  const { t } = useTranslation('pins');
  const { pinChatMessage } = useRoom('pinChatMessage');
  // kept after closing so the text doesn't change while the dialog fades out
  const [target, setTarget] = useState<{ msgId: number; pinned: boolean; shiftHint: boolean } | null>(null);
  const [open, setOpen] = useState(false);

  function requestPin(msgId: number, pinned: boolean, skipConfirm = false) {
    if (skipConfirm) { void pinChatMessage(msgId, pinned).then(onDone); return; }
    // read once on open rather than subscribing: every message row owns one of these
    const shiftHint = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
    setTarget({ msgId, pinned, shiftHint });
    setOpen(true);
  }

  const kind = target?.pinned === false ? 'unpin' : 'pin';
  const pinConfirmDialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={t(`confirm.${kind}.title`)}
      description={target?.shiftHint ? t(`confirm.${kind}.descriptionShift`) : t(`confirm.${kind}.description`)}
      confirmLabel={t(`confirm.${kind}.confirm`)}
      destructive={kind === 'unpin'}
      onConfirm={() => { if (target) void pinChatMessage(target.msgId, target.pinned).then(onDone); }}
    />
  );

  return { requestPin, pinConfirmDialog };
}
