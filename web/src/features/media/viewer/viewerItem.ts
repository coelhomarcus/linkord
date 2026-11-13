/** Where an inline video was when it was opened in the viewer, so it carries on from there. */
export interface PlaybackPosition {
  time: number;
  playing: boolean;
}

/** One picture, GIF or video of the media viewer. */
export interface ViewerItem {
  /** stable within a set: what a thumbnail or an inline control names to open this one */
  key: string;
  /** what the viewer draws: the full-size picture or the video */
  src: string;
  /** what download, "open original" and "copy link" use */
  originalSrc: string;
  /** a small still for the thumbnail strip; an icon tile when absent */
  thumbSrc?: string;
  width?: number;
  height?: number;
  kind: 'image' | 'gif' | 'video';
  name: string;
  size?: number;
  /** base64 ThumbHash painted while the picture loads */
  placeholder?: string | null;
  /** several frames: not preloaded or warmed, since that would decode it for nothing */
  animated?: boolean;
  /** the attachment it is, for "remove attachment" */
  attachmentId?: string;
  startAt?: PlaybackPosition;
  /** the message it was sent in, for the actions on it (reply, jump, delete) */
  message?: ViewerContext;
}

/** The message the set belongs to, for the actions that act on it. */
export interface ViewerContext {
  conversationId: string;
  msgId: number;
}

/** Pictures can be zoomed and rotated; a video has its own player. */
export function isStill(item: ViewerItem | undefined): boolean {
  return item?.kind === 'image' || item?.kind === 'gif';
}

/** Worth fetching ahead of time: a still picture. A GIF or an animated picture would be decoded for
 * nothing, and a video is never fetched before it is asked to play. */
export function isWarmable(item: ViewerItem | undefined): item is ViewerItem {
  return item?.kind === 'image' && !item.animated;
}

/** The reader asked their browser to spend less data (Chrome's Save-Data / Lite mode). */
export function prefersSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return connection?.saveData === true;
}

const warmed = new Set<string>();

/** Starts loading a full picture into the browser's cache. Each address once per page. */
export function warmImage(src: string): void {
  if (warmed.has(src) || typeof Image === 'undefined') return;
  warmed.add(src);
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
}

/** Test seam: forget what was warmed. */
export function resetWarmedImages(): void {
  warmed.clear();
}
