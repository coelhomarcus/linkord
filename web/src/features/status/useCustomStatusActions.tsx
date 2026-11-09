import { useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { i18n } from '@/shared/i18n/init';
import { CustomStatusDialog } from './CustomStatusDialog';

/** What the owner's CustomStatusBubble needs: open the editor, clear the status, and the editor
 * itself (`dialog`), which the caller renders somewhere that outlives a closing popover. */
export function useCustomStatusActions(onError: (message: string) => void) {
  const { setPresence } = useRoom();
  const [editorOpen, setEditorOpen] = useState(false);

  function clear() {
    setPresence({ customStatus: null })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : i18n.t('status:errors.saveFailed')));
  }

  return {
    openEditor: () => setEditorOpen(true),
    clear,
    dialog: <CustomStatusDialog open={editorOpen} onOpenChange={setEditorOpen} />,
  };
}
