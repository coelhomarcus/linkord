import i18n from 'i18next';
import Code from 'kubai-icons-react/icons/code';
import Heart from 'kubai-icons-react/icons/heart';
import type { KubaiIconComponent, KubaiIconProps } from 'kubai-icons-react';

// The profile badges there are, in the order a profile shows them. Keep in step with the server
// catalog (server/src/modules/badges/badgeCatalog.ts). Each icon is imported on its own, so the
// apps carry only these two of the Kubai set.

const BADGES = [
  { id: 'developer', icon: Code, color: '#5B8CFF' },
  { id: 'supporter', icon: Heart, color: '#F0509A' },
] as const satisfies readonly { id: string; icon: KubaiIconComponent; color: string }[];

export type BadgeId = (typeof BADGES)[number]['id'];

/** A badge an account holds, as the server sends it. */
export interface HeldBadge { id: BadgeId; grantedAt: string }

function badgeInfo(id: string) {
  return BADGES.find((badge) => badge.id === id);
}

/** Leaves out a badge this build does not know yet (a newer server) and keeps catalog order. */
export function knownBadges<T extends { id: string }>(badges: readonly T[] | undefined): (T & { id: BadgeId })[] {
  const known = (badges ?? []).filter((badge): badge is T & { id: BadgeId } => !!badgeInfo(badge.id));
  return known.sort((a, b) => BADGES.findIndex((x) => x.id === a.id) - BADGES.findIndex((x) => x.id === b.id));
}

export const badgeName = (id: BadgeId): string => i18n.t(`badges:${id}.name`);
export const badgeDescription = (id: BadgeId): string => i18n.t(`badges:${id}.description`);

/** The badge's icon in its own colour. Without `title` it is decorative. */
export function BadgeIcon({ id, size = 20, ...props }: { id: BadgeId } & Omit<KubaiIconProps, 'color'>) {
  const badge = badgeInfo(id);
  if (!badge) return null;
  const Icon = badge.icon;
  return <Icon size={size} color={badge.color} {...props} />;
}
