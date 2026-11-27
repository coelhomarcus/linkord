import type { IconWeight } from './createIcon';

export type { IconComponent, IconWeight } from './createIcon';
export * from './fluent';

export function iconWeight(active: boolean): IconWeight {
  return active ? 'fill' : 'regular';
}
