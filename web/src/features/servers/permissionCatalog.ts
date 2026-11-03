import { PERMISSIONS, type PermissionName } from './permissionBits';

/** How the role and channel editors group the permissions. `channel`: the
 * ones a channel overwrite can change. Labels are `servers:permissions.<NAME>`. */
export const PERMISSION_SECTIONS: { key: 'general' | 'members' | 'text' | 'voice'; names: PermissionName[] }[] = [
  { key: 'general', names: ['ADMINISTRATOR', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_CHANNELS', 'MANAGE_EXPRESSIONS', 'MANAGE_WEBHOOKS', 'VIEW_CHANNEL'] },
  { key: 'members', names: ['CREATE_INVITE', 'KICK_MEMBERS', 'BAN_MEMBERS'] },
  { key: 'text', names: ['SEND_MESSAGES', 'ATTACH_FILES', 'ADD_REACTIONS', 'MANAGE_MESSAGES'] },
  { key: 'voice', names: ['CONNECT', 'SPEAK', 'STREAM', 'USE_SOUNDBOARD', 'MOVE_MEMBERS'] },
];

const SERVER_ONLY: PermissionName[] = ['ADMINISTRATOR', 'MANAGE_SERVER', 'MANAGE_ROLES', 'MANAGE_EXPRESSIONS', 'KICK_MEMBERS', 'BAN_MEMBERS'];

export function channelPermissionNames(type: 'text' | 'voice' | 'category'): PermissionName[] {
  const names = PERMISSION_SECTIONS.flatMap((s) => s.names).filter((n) => !SERVER_ONLY.includes(n));
  if (type === 'text') return names.filter((n) => !['CONNECT', 'SPEAK', 'STREAM', 'USE_SOUNDBOARD', 'MOVE_MEMBERS'].includes(n));
  if (type === 'voice') return names.filter((n) => !['MANAGE_WEBHOOKS', 'ATTACH_FILES', 'ADD_REACTIONS'].includes(n));
  return names;
}

export const bitOf = (name: PermissionName) => PERMISSIONS[name];
