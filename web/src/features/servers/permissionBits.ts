// Mirrors server/src/modules/servers/permissions.ts — the server resolves
// effective permissions and sends them as numbers; the client only reads
// bits. server/tests/modules/servers/permissions.test.ts fails if the two drift.
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
  VIEW_AUDIT_LOG: 1 << 19,
  CREATE_EXPRESSIONS: 1 << 20,
} as const;

export type PermissionName = keyof typeof PERMISSIONS;

export function hasPermission(permissions: number, bit: number): boolean {
  return (permissions & bit) === bit;
}
