import type { IconWeight } from './createIcon';

export type { IconComponent, IconWeight } from './createIcon';
export * from './fluent';
export * from './brands';

export function iconWeight(active: boolean): IconWeight {
  return active ? 'fill' : 'regular';
}
