import { fitGrid, gridGap } from './callLayoutMetrics';
import type { TileDescriptor } from './tileTypes';

export const DM_AVATAR_GAP = 24;
const MAX_AVATAR = 96;
const MIN_AVATAR = 48;
/** beside video an avatar reads as a participant chip, not the main subject */
const MAX_AVATAR_BESIDE_VIDEO = 80;

/** Splits the call into what plays as video and who stays a round avatar.
 * A camera still attaching keeps its owner an avatar (with a spinner) so the
 * row does not reflow into a black tile and back. */
export function splitDmCallMedia(descriptors: TileDescriptor[]): { videos: TileDescriptor[]; pendingCameraIds: Set<string> } {
  const videos = descriptors.filter((d) => d.kind === 'screen' || d.kind === 'camera');
  const pendingCameraIds = new Set(descriptors.filter((d) => d.kind === 'avatar' && d.loading).map((d) => d.participantId));
  return { videos, pendingCameraIds };
}

export function dmAvatarSize(height: number, besideVideo: boolean): number {
  const max = besideVideo ? MAX_AVATAR_BESIDE_VIDEO : MAX_AVATAR;
  return Math.max(MIN_AVATAR, Math.min(max, Math.round(height * 0.45)));
}

export interface DmVideoFit {
  cols: number;
  tileW: number;
  tileH: number;
  gap: number;
}

/** The largest 16:9 tiles for `videoCount` videos once the avatars beside
 * them have taken their share of the row. */
export function fitDmVideos(videoCount: number, avatarCount: number, width: number, height: number, avatarSize: number): DmVideoFit | null {
  if (videoCount <= 0) return null;
  const avatarsWidth = avatarCount > 0 ? avatarCount * (avatarSize + DM_AVATAR_GAP) : 0;
  const fit = fitGrid(videoCount, width - avatarsWidth, height, 0);
  if (!fit) return null;
  return { cols: fit.cols, tileW: Math.floor(fit.tileW), tileH: Math.floor(fit.tileH), gap: gridGap(videoCount) };
}

export const DM_STRIP_THUMB = { w: 160, h: 90 };
export const DM_STRIP_AVATAR = 56;
const STRIP_GAP = 12;
/** the strip's own padding, which keeps the speaking ring from being clipped */
export const DM_STRIP_PADDING = 4;
// the speaking ring sits 4px outside an avatar
const RING_OUTSET = 8;
const MIN_STRIP_SCALE = 0.4;

/** How much the strip beside a focused video shrinks so everyone in it fits
 * the call's height; a short call would otherwise clip the last of them. */
export function dmStripScale(videoCount: number, avatarCount: number, height: number): number {
  const items = videoCount + avatarCount;
  if (items === 0 || height <= 0) return 1;
  const natural = videoCount * DM_STRIP_THUMB.h + avatarCount * (DM_STRIP_AVATAR + RING_OUTSET);
  const room = height - 2 * DM_STRIP_PADDING - STRIP_GAP * (items - 1);
  return Math.max(MIN_STRIP_SCALE, Math.min(1, room / natural));
}
