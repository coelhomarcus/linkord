import type { RoleSummary, ServerSummary } from '@/shared/types/protocol';
import { hasPermission, PERMISSIONS } from './permissionBits';

// The server's hierarchy rules (server/src/modules/servers/permissions.ts and
// roles.ts), read on the client only to grey out what the server would
// refuse with 403. The server still decides.

const ALL = Object.values(PERMISSIONS).reduce((all, bit) => all | bit, 0);

const isOwner = (server: ServerSummary, myUserId: string | null) => !!myUserId && server.ownerId === myUserId;

/** The position of the highest role held; the owner sits above every role. */
export function myTopPosition(server: ServerSummary, myUserId: string | null): number {
  if (isOwner(server, myUserId)) return Number.POSITIVE_INFINITY;
  return topPositionOf(server, server.myRoleIds);
}

function topPositionOf(server: ServerSummary, roleIds: readonly string[]): number {
  const held = new Set(roleIds);
  return server.roles.reduce((top, role) => (held.has(role.id) && role.position > top ? role.position : top), 0);
}

/** The bits this member may put in a role or an overwrite. */
export function grantableBits(server: ServerSummary): number {
  return hasPermission(server.permissions, PERMISSIONS.ADMINISTRATOR) ? ALL : server.permissions;
}

/** Whether the member may edit, assign or delete `role`: MANAGE_ROLES and a
 * role strictly below their highest. @everyone's permissions are editable by
 * any manager; it just can't be deleted or moved. */
export function canManageRole(server: ServerSummary, myUserId: string | null, role: RoleSummary): boolean {
  if (!hasPermission(server.permissions, PERMISSIONS.MANAGE_ROLES)) return false;
  return role.isDefault || myTopPosition(server, myUserId) > role.position;
}

/** Whether the member may hand `role` to someone: managing it, and holding
 * every permission it carries. */
export function canAssignRole(server: ServerSummary, myUserId: string | null, role: RoleSummary): boolean {
  return !role.isDefault && canManageRole(server, myUserId, role) && (role.permissions & ~grantableBits(server)) === 0;
}

/** Whether the member outranks `target` (kick, ban, roles): never the owner
 * or oneself, otherwise a strictly higher top role. */
export function outranks(server: ServerSummary, myUserId: string | null, target: { userId: string; roleIds: readonly string[]; isOwner: boolean }): boolean {
  if (target.isOwner || target.userId === myUserId) return false;
  return myTopPosition(server, myUserId) > topPositionOf(server, target.roleIds);
}
