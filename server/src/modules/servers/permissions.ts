// Server permissions, resolved the way Discord does it. Each flag's bit is
// permanent: it is stored in server_roles.permissions and in channel
// overwrites, so a flag is only ever appended, never renumbered. The same
// table is mirrored in web/src/features/servers/permissionBits.ts —
// server/tests/modules/servers/permissions.test.ts fails if the two drift.
//
// Stored as a Postgres integer and combined with JS bitwise operators, both
// of which top out at 31 usable bits; 19 are in use.
export const PERMISSIONS = {
  ADMINISTRATOR: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  CREATE_INVITE: 1 << 4,
  KICK_MEMBERS: 1 << 5,
  BAN_MEMBERS: 1 << 6,
  VIEW_CHANNEL: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  ATTACH_FILES: 1 << 9,
  ADD_REACTIONS: 1 << 10,
  MANAGE_MESSAGES: 1 << 11,
  MANAGE_WEBHOOKS: 1 << 12,
  CONNECT: 1 << 13,
  SPEAK: 1 << 14,
  STREAM: 1 << 15,
  MOVE_MEMBERS: 1 << 16,
  USE_SOUNDBOARD: 1 << 17,
  MANAGE_EXPRESSIONS: 1 << 18,
} as const;

export type PermissionName = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.values(PERMISSIONS).reduce((all, bit) => all | bit, 0);

/** What a brand-new server's @everyone can do — also what the migration
 * gives every group that becomes a server, so nobody loses anything they
 * could do in the group. */
export const DEFAULT_EVERYONE_PERMISSIONS = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES
  | PERMISSIONS.ATTACH_FILES | PERMISSIONS.ADD_REACTIONS | PERMISSIONS.CREATE_INVITE
  | PERMISSIONS.CONNECT | PERMISSIONS.SPEAK | PERMISSIONS.STREAM | PERMISSIONS.USE_SOUNDBOARD;

export interface RoleInput {
  id: string;
  permissions: number;
  position: number;
  isDefault: boolean;
}

export interface OverwriteInput {
  roleId: string | null;
  userId: string | null;
  allow: number;
  deny: number;
}

export interface MemberInput {
  userId: string;
  roleIds: readonly string[];
  isOwner: boolean;
}

export function hasPermission(permissions: number, bit: number): boolean {
  return (permissions & bit) === bit;
}

/** Server-wide permissions: what applies before any channel is involved. */
export function computeBasePermissions(member: MemberInput, roles: readonly RoleInput[]): number {
  if (member.isOwner) return ALL_PERMISSIONS;
  const held = new Set(member.roleIds);
  let permissions = 0;
  for (const role of roles) {
    if (role.isDefault || held.has(role.id)) permissions |= role.permissions;
  }
  return hasPermission(permissions, PERMISSIONS.ADMINISTRATOR) ? ALL_PERMISSIONS : permissions;
}

/** Channel permissions: base permissions, then the channel's (or its synced
 * category's) overwrites — @everyone first, then every role the member holds
 * combined, then the member's own — so a more specific rule always wins. */
export function computeChannelPermissions(
  member: MemberInput,
  roles: readonly RoleInput[],
  overwrites: readonly OverwriteInput[],
): number {
  const base = computeBasePermissions(member, roles);
  if (hasPermission(base, PERMISSIONS.ADMINISTRATOR)) return ALL_PERMISSIONS;

  const everyoneRole = roles.find((role) => role.isDefault);
  const held = new Set(member.roleIds);
  let permissions = base;

  const everyone = everyoneRole ? overwrites.find((o) => o.roleId === everyoneRole.id) : undefined;
  if (everyone) permissions = (permissions & ~everyone.deny) | everyone.allow;

  let roleAllow = 0;
  let roleDeny = 0;
  for (const overwrite of overwrites) {
    if (overwrite.roleId && overwrite.roleId !== everyoneRole?.id && held.has(overwrite.roleId)) {
      roleAllow |= overwrite.allow;
      roleDeny |= overwrite.deny;
    }
  }
  permissions = (permissions & ~roleDeny) | roleAllow;

  const own = overwrites.find((o) => o.userId === member.userId);
  if (own) permissions = (permissions & ~own.deny) | own.allow;

  // Without seeing a channel nothing else in it applies, and without sending
  // there is nothing to attach a file to.
  if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL)) return 0;
  if (!hasPermission(permissions, PERMISSIONS.SEND_MESSAGES)) permissions &= ~PERMISSIONS.ATTACH_FILES;
  return permissions;
}

/** The position of the member's highest role; @everyone (position 0) when
 * they hold none. The owner sits above every role. */
export function highestRolePosition(member: MemberInput, roles: readonly RoleInput[]): number {
  if (member.isOwner) return Number.POSITIVE_INFINITY;
  const held = new Set(member.roleIds);
  return roles.reduce((top, role) => (held.has(role.id) && role.position > top ? role.position : top), 0);
}

/** Whether `actor` may edit, assign or delete `role`: only roles strictly
 * below their own highest one, and never @everyone's existence. */
export function canManageRole(actor: MemberInput, role: RoleInput, roles: readonly RoleInput[]): boolean {
  if (!hasPermission(computeBasePermissions(actor, roles), PERMISSIONS.MANAGE_ROLES)) return false;
  return actor.isOwner || highestRolePosition(actor, roles) > role.position;
}

/** Whether `actor` may act on `target` (kick, ban, change their roles). The
 * owner is untouchable; anyone else only reaches members strictly below. */
export function outranks(actor: MemberInput, target: MemberInput, roles: readonly RoleInput[]): boolean {
  if (target.isOwner || actor.userId === target.userId) return false;
  return actor.isOwner || highestRolePosition(actor, roles) > highestRolePosition(target, roles);
}
