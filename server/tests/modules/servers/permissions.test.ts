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

  it('applies @everyone, then the held roles together, then the member — the narrower rule wins', () => {
    const overwrites = [
      { roleId: 'everyone', userId: null, allow: P.MANAGE_MESSAGES, deny: P.ADD_REACTIONS | P.SEND_MESSAGES },
      { roleId: 'helper', userId: null, allow: P.SEND_MESSAGES, deny: P.MANAGE_MESSAGES },
      { roleId: null, userId: 'h', allow: P.ADD_REACTIONS, deny: 0 },
    ];
    const plain = computeChannelPermissions(member('u'), roles, overwrites);
    assert.ok(hasPermission(plain, P.MANAGE_MESSAGES) && !hasPermission(plain, P.SEND_MESSAGES) && !hasPermission(plain, P.ADD_REACTIONS));
    const helped = computeChannelPermissions(member('h', ['helper']), roles, overwrites);
    assert.ok(hasPermission(helped, P.SEND_MESSAGES) && hasPermission(helped, P.ADD_REACTIONS) && !hasPermission(helped, P.MANAGE_MESSAGES));
  });

  it('a role overwrite of a role the member does not hold changes nothing for them', () => {
    const overwrites = [{ roleId: 'mod', userId: null, allow: 0, deny: P.SEND_MESSAGES }];
    assert.ok(hasPermission(computeChannelPermissions(member('h', ['helper']), roles, overwrites), P.SEND_MESSAGES));
  });

  it('an allow of VIEW_CHANNEL brings back the base bits the overwrites left alone', () => {
    const overwrites = [
      { roleId: 'everyone', userId: null, allow: 0, deny: P.VIEW_CHANNEL },
      { roleId: null, userId: 'u', allow: P.VIEW_CHANNEL, deny: 0 },
    ];
    assert.equal(computeChannelPermissions(member('u'), roles, overwrites), DEFAULT_EVERYONE_PERMISSIONS);
  });

  it('without VIEW_CHANNEL every other allow is void, even the member\'s own', () => {
    const overwrites = [{ roleId: null, userId: 'u', allow: P.MANAGE_MESSAGES | P.SEND_MESSAGES, deny: P.VIEW_CHANNEL }];
    assert.equal(computeChannelPermissions(member('u'), roles, overwrites), 0);
  });

  it('an allow of ATTACH_FILES does not survive a deny of SEND_MESSAGES', () => {
    const overwrites = [{ roleId: 'everyone', userId: null, allow: P.ATTACH_FILES, deny: P.SEND_MESSAGES }];
    assert.ok(!hasPermission(computeChannelPermissions(member('u'), roles, overwrites), P.ATTACH_FILES));
  });

  it('ADMINISTRATOR given by a role makes every overwrite irrelevant, but not by an overwrite', () => {
    const overwrites = [{ roleId: 'everyone', userId: null, allow: P.ADMINISTRATOR, deny: 0 }];
    // an overwrite cannot make someone an administrator: only the bit itself comes through
    const permissions = computeChannelPermissions(member('u'), roles, overwrites);
    assert.notEqual(permissions, ALL_PERMISSIONS);
    assert.ok(!hasPermission(permissions, P.MANAGE_SERVER));
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

  it('two roles at the same position do not outrank each other', () => {
    const twinA: RoleInput = { id: 'twin-a', permissions: P.MANAGE_ROLES | P.KICK_MEMBERS, position: 2, isDefault: false };
    const twinB: RoleInput = { id: 'twin-b', permissions: P.MANAGE_ROLES, position: 2, isDefault: false };
    const twins = [everyone, twinA, twinB];
    assert.ok(!outranks(member('a', ['twin-a']), member('b', ['twin-b']), twins));
    assert.ok(!canManageRole(member('a', ['twin-a']), twinB, twins));
  });

  it('someone with no role sits with @everyone: only a member with a role outranks them', () => {
    assert.ok(!outranks(member('u'), member('v'), roles));
    assert.ok(outranks(member('h', ['helper']), member('v'), roles));
    // a MANAGE_ROLES given to @everyone manages nothing above it
    const open = [{ ...everyone, permissions: everyone.permissions | P.MANAGE_ROLES }, helper];
    assert.ok(!canManageRole(member('u'), helper, open));
  });

  it('never reaches the owner or oneself', () => {
    assert.ok(outranks(member('m', ['mod']), member('h', ['helper']), roles));
    assert.ok(!outranks(member('h', ['helper']), member('m', ['mod']), roles));
    assert.ok(!outranks(member('a', ['admin']), member('o', [], true), roles));
    assert.ok(!outranks(member('m', ['mod']), member('m', ['mod']), roles));
    assert.ok(outranks(member('o', [], true), member('a', ['admin']), roles));
  });
});
