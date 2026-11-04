import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ALL_PERMISSIONS, canManageRole, computeBasePermissions, computeChannelPermissions, DEFAULT_EVERYONE_PERMISSIONS,
  hasPermission, highestRolePosition, outranks, PERMISSIONS, type MemberInput, type RoleInput,
} from '../../../src/modules/servers/permissions.js';

const WEB_BITS = path.resolve(import.meta.dirname, '../../../../web/src/features/servers/permissionBits.ts');
const P = PERMISSIONS;

const everyone: RoleInput = { id: 'everyone', permissions: DEFAULT_EVERYONE_PERMISSIONS, position: 0, isDefault: true };
const mod: RoleInput = { id: 'mod', permissions: P.MANAGE_MESSAGES | P.KICK_MEMBERS | P.MANAGE_ROLES, position: 2, isDefault: false };
const helper: RoleInput = { id: 'helper', permissions: P.MANAGE_MESSAGES, position: 1, isDefault: false };
const admin: RoleInput = { id: 'admin', permissions: P.ADMINISTRATOR, position: 3, isDefault: false };
const roles = [everyone, mod, helper, admin];

const member = (userId: string, roleIds: string[] = [], isOwner = false): MemberInput => ({ userId, roleIds, isOwner });

describe('permission bits', () => {
  it('matches the web mirror bit for bit', () => {
    const source = fs.readFileSync(WEB_BITS, 'utf8');
    const web = Object.fromEntries([...source.matchAll(/(\w+): 1 << (\d+)/g)].map((m) => [m[1], 1 << Number(m[2])]));
    assert.deepEqual(web, { ...PERMISSIONS });
  });

  it('fits in a 31-bit integer', () => {
    assert.ok(ALL_PERMISSIONS > 0 && ALL_PERMISSIONS < 2 ** 31);
  });
});

describe('computeBasePermissions', () => {
  it('gives @everyone to every member', () => {
    assert.equal(computeBasePermissions(member('u'), roles), DEFAULT_EVERYONE_PERMISSIONS);
  });

  it('adds up every held role', () => {
    const permissions = computeBasePermissions(member('u', ['mod']), roles);
    assert.ok(hasPermission(permissions, P.KICK_MEMBERS));
    assert.ok(hasPermission(permissions, P.SEND_MESSAGES));
    assert.ok(!hasPermission(permissions, P.MANAGE_SERVER));
  });

  it('gives the owner and administrators everything', () => {
    assert.equal(computeBasePermissions(member('o', [], true), roles), ALL_PERMISSIONS);
    assert.equal(computeBasePermissions(member('a', ['admin']), roles), ALL_PERMISSIONS);
  });
});

describe('computeChannelPermissions', () => {
  it('hides a channel denied to @everyone but shown to a role', () => {
    const overwrites = [
      { roleId: 'everyone', userId: null, allow: 0, deny: P.VIEW_CHANNEL },
      { roleId: 'helper', userId: null, allow: P.VIEW_CHANNEL, deny: 0 },
    ];
    assert.equal(computeChannelPermissions(member('u'), roles, overwrites), 0);
    assert.ok(hasPermission(computeChannelPermissions(member('h', ['helper']), roles, overwrites), P.VIEW_CHANNEL));
  });

  it('lets a member overwrite beat a role overwrite', () => {
    const overwrites = [
      { roleId: 'helper', userId: null, allow: 0, deny: P.SEND_MESSAGES },
      { roleId: null, userId: 'h', allow: P.SEND_MESSAGES, deny: 0 },
    ];
    assert.ok(hasPermission(computeChannelPermissions(member('h', ['helper']), roles, overwrites), P.SEND_MESSAGES));
  });

  it('lets an allow on any held role beat a deny on another', () => {
    const overwrites = [
      { roleId: 'helper', userId: null, allow: 0, deny: P.ADD_REACTIONS },
      { roleId: 'mod', userId: null, allow: P.ADD_REACTIONS, deny: 0 },
    ];
    assert.ok(hasPermission(computeChannelPermissions(member('x', ['helper', 'mod']), roles, overwrites), P.ADD_REACTIONS));
  });

  it('takes attachments away along with sending', () => {
    const overwrites = [{ roleId: 'everyone', userId: null, allow: 0, deny: P.SEND_MESSAGES }];
    const permissions = computeChannelPermissions(member('u'), roles, overwrites);
    assert.ok(hasPermission(permissions, P.VIEW_CHANNEL));
    assert.ok(!hasPermission(permissions, P.ATTACH_FILES));
  });

  it('ignores overwrites for the owner and administrators', () => {
    const overwrites = [{ roleId: 'everyone', userId: null, allow: 0, deny: P.VIEW_CHANNEL }];
    assert.equal(computeChannelPermissions(member('o', [], true), roles, overwrites), ALL_PERMISSIONS);
    assert.equal(computeChannelPermissions(member('a', ['admin']), roles, overwrites), ALL_PERMISSIONS);
  });
});

describe('role hierarchy', () => {
  it('ranks by the highest held role', () => {
    assert.equal(highestRolePosition(member('u'), roles), 0);
    assert.equal(highestRolePosition(member('u', ['helper', 'mod']), roles), 2);
    assert.equal(highestRolePosition(member('o', [], true), roles), Number.POSITIVE_INFINITY);
  });

  it('only manages roles strictly below and only with MANAGE_ROLES', () => {
    assert.ok(canManageRole(member('m', ['mod']), helper, roles));
    assert.ok(!canManageRole(member('m', ['mod']), mod, roles));
    assert.ok(!canManageRole(member('h', ['helper']), everyone, roles));
    assert.ok(canManageRole(member('o', [], true), admin, roles));
  });

  it('never reaches the owner or oneself', () => {
    assert.ok(outranks(member('m', ['mod']), member('h', ['helper']), roles));
    assert.ok(!outranks(member('h', ['helper']), member('m', ['mod']), roles));
    assert.ok(!outranks(member('a', ['admin']), member('o', [], true), roles));
    assert.ok(!outranks(member('m', ['mod']), member('m', ['mod']), roles));
    assert.ok(outranks(member('o', [], true), member('a', ['admin']), roles));
  });
});
