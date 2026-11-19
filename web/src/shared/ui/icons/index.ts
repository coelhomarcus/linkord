import type { IconWeight } from './createIcon';

export type { IconComponent, IconWeight } from './createIcon';
export * from './phosphor';

export function iconWeight(active: boolean): IconWeight {
  return active ? 'fill' : 'regular';
}
