import { hashString } from './playgroundWorld';

// KayKit Adventurers (Kay Lousberg, CC0): six characters on one shared rig, so
// the two animation files drive every one of them.

export const CHARACTER_IDS = ['knight', 'barbarian', 'mage', 'ranger', 'rogue', 'rogueHooded'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

/** Until people can pick one, each account always gets the same character. */
export function characterFor(userId: string): CharacterId {
  return CHARACTER_IDS[hashString(userId) % CHARACTER_IDS.length]!;
}
