import type { ServerSticker } from './stickersApi';

// How anything asks StickerEditorHost (mounted once, in App) for the upload
// or edit dialog: the picker's "add" tile closes its popover as it asks, so
// the dialog can't live inside it.

type Opener = (request: { serverId: string; sticker?: ServerSticker }) => void;
let opener: Opener | null = null;

export function registerStickerEditorOpener(next: Opener): () => void {
  opener = next;
  return () => { if (opener === next) opener = null; };
}

/** The upload dialog for `serverId`, or the edit one for `sticker`. */
export function requestStickerEditor(serverId: string, sticker?: ServerSticker): void {
  opener?.({ serverId, sticker });
}
