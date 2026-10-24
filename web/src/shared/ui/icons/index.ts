import type { Icon, IconWeight } from '@phosphor-icons/react';

export type IconComponent = Icon;

export function iconWeight(active: boolean): IconWeight {
  return active ? 'fill' : 'regular';
}
