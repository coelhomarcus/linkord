import type { TileDescriptor } from './tileTypes';

/** True when someone is on camera or sharing a screen, including a track that is still attaching or paused. */
export function dmCallHasMedia(descriptors: TileDescriptor[]): boolean {
  return descriptors.some((descriptor) => descriptor.kind !== 'avatar' || descriptor.loading);
}
