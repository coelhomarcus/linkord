import { useEffect, useState } from 'react';

import { StickerEditorDialog } from './StickerEditorDialog';
import { registerStickerEditorOpener } from './stickerEditorRequest';
import type { ServerSticker } from './stickersApi';
import { invalidateServerStickers } from './useServerStickers';

// One editor for the whole app: the server's settings page and the picker's
// "add" tile both ask it, and it lives outside both, so a picker that closes
// as the dialog opens doesn't take the dialog with it.

export function StickerEditorHost() {
  const [request, setRequest] = useState<{ serverId: string; sticker?: ServerSticker } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => registerStickerEditorOpener((next) => { setRequest(next); setOpen(true); }), []);

  if (!request) return null;
  return (
    <StickerEditorDialog
      serverId={request.serverId}
      sticker={request.sticker ?? null}
      open={open}
      onOpenChange={setOpen}
      onSaved={() => invalidateServerStickers(request.serverId)}
    />
  );
}
