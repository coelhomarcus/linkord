import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { canAssignRole, canManageRole, grantableBits, myTopPosition, outranks } from '@/features/servers/roleHierarchy';
import type { RoleSummary, ServerSummary } from '@/shared/types/protocol';

const role = (id: string, position: number, permissions = 0, isDefault = false): RoleSummary => ({
  id, name: id, color: '', position, permissions, hoist: false, mentionable: false, isDefault,
});
const everyone = role('everyone', 0, PERMISSIONS.VIEW_CHANNEL, true);
const helper = role('helper', 1, PERMISSIONS.MANAGE_MESSAGES);
const bans = role('bans', 2, PERMISSIONS.BAN_MEMBERS);
const lead = role('lead', 3, PERMISSIONS.MANAGE_ROLES | PERMISSIONS.MANAGE_MESSAGES);
const server = (over: Partial<ServerSummary> = {}): ServerSummary => ({
  id: 's1', name: 'Squad', icon: '', ownerId: 'owner', status: 'active', createdAt: 0, memberCount: 3, position: 0,
  permissions: PERMISSIONS.MANAGE_ROLES | PERMISSIONS.MANAGE_MESSAGES | PERMISSIONS.VIEW_CHANNEL,
  myRoleIds: ['lead'], roles: [everyone, helper, bans, lead], categories: [], channels: [], ...over,
});

describe('roleHierarchy (mirrors the server)', () => {
  it('ranks by the highest role held, the owner above all', () => {
    expect(myTopPosition(server(), 'me')).toBe(3);
    expect(myTopPosition(server({ ownerId: 'me' }), 'me')).toBe(Number.POSITIVE_INFINITY);
  });

  it('manages only roles strictly below, and @everyone', () => {
    expect(canManageRole(server(), 'me', helper)).toBe(true);
    expect(canManageRole(server(), 'me', lead)).toBe(false);
    expect(canManageRole(server(), 'me', everyone)).toBe(true);
    expect(canManageRole(server({ permissions: PERMISSIONS.VIEW_CHANNEL }), 'me', helper)).toBe(false);
  });

  it('hands out only roles whose permissions the member holds', () => {
    expect(canAssignRole(server(), 'me', helper)).toBe(true);
    expect(canAssignRole(server(), 'me', bans)).toBe(false);
    expect(canAssignRole(server({ permissions: PERMISSIONS.ADMINISTRATOR | PERMISSIONS.MANAGE_ROLES }), 'me', bans)).toBe(true);
    expect(canAssignRole(server(), 'me', everyone)).toBe(false);
  });

  it('grants everything as an administrator, otherwise what it holds', () => {
    expect(grantableBits(server()) & PERMISSIONS.BAN_MEMBERS).toBe(0);
    expect(grantableBits(server({ permissions: PERMISSIONS.ADMINISTRATOR })) & PERMISSIONS.BAN_MEMBERS).toBe(PERMISSIONS.BAN_MEMBERS);
  });

  it('outranks only members strictly below, never the owner or oneself', () => {
    expect(outranks(server(), 'me', { userId: 'u', roleIds: ['bans'], isOwner: false })).toBe(true);
    expect(outranks(server(), 'me', { userId: 'u', roleIds: ['lead'], isOwner: false })).toBe(false);
    expect(outranks(server(), 'me', { userId: 'owner', roleIds: [], isOwner: true })).toBe(false);
    expect(outranks(server(), 'me', { userId: 'me', roleIds: [], isOwner: false })).toBe(false);
  });
});
