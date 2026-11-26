// The profile badges there are, in the order a profile shows them. A leaf module, so the schema can
// name its types. Keep in step with the web catalog (packages/frontend-shared/src/badges/badgeCatalog.tsx)
// and with the user_badges check constraint.

const BADGE_IDS = ['developer', 'supporter'] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

/** Who manages a held badge: an admin by hand, or a rule that awards it on its own. */
const BADGE_SOURCES = ['admin', 'automatic'] as const;
export type BadgeSource = (typeof BADGE_SOURCES)[number];

export function isBadgeId(value: unknown): value is BadgeId {
  return typeof value === 'string' && (BADGE_IDS as readonly string[]).includes(value);
}

/** Catalog order, whatever order the rows came in. */
export function sortBadges<T extends { id: BadgeId }>(badges: T[]): T[] {
  return [...badges].sort((a, b) => BADGE_IDS.indexOf(a.id) - BADGE_IDS.indexOf(b.id));
}
