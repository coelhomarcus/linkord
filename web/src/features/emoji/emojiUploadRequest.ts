import { suggestEmojiName } from './serverEmojisApi';

// How anything asks EmojiUploadHost (mounted once, in App) for an upload.

type Opener = (serverId: string, taken?: Set<string>) => void;
let opener: Opener | null = null;

/** The host (EmojiUploadHost) takes the requests while it is mounted. */
export function registerEmojiUploadOpener(next: Opener): () => void {
  opener = next;
  return () => { if (opener === next) opener = null; };
}

/** Opens the file chooser, then the crop, for an emoji of `serverId`. Call it
 * from the click itself: browsers only open a file chooser from one. */
export function requestEmojiUpload(serverId: string, taken?: Set<string>): void {
  opener?.(serverId, taken);
}

/** A name not taken yet in the server, from the file's name. */
export function freeEmojiName(fileName: string, taken: Set<string>): string {
  const base = suggestEmojiName(fileName) || 'emoji';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, 32 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}
