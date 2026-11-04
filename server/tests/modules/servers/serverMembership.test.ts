import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideRemoval, decideTransfer } from '../../../src/modules/servers/serverMembership.js';

const base = {
  actorIsMember: true, targetIsMember: true, isSelf: false, targetIsOwner: false,
  actorHasPermission: true, actorOutranksTarget: true, memberCount: 3,
};

describe('decideRemoval', () => {
  it('a member with the permission removes someone below them', () => {
    assert.equal(decideRemoval(base), 'allow');
  });

  it('the permission alone is not enough: the target must be below', () => {
    assert.equal(decideRemoval({ ...base, actorOutranksTarget: false }), 'forbidden');
    assert.equal(decideRemoval({ ...base, actorHasPermission: false }), 'forbidden');
  });

  it('anyone leaves on their own', () => {
    assert.equal(decideRemoval({ ...base, isSelf: true, actorHasPermission: false, actorOutranksTarget: false }), 'allow');
  });

  it('the owner only leaves when alone — otherwise a transfer is required', () => {
    assert.equal(decideRemoval({ ...base, isSelf: true, targetIsOwner: true, memberCount: 2 }), 'owner_must_transfer');
    assert.equal(decideRemoval({ ...base, isSelf: true, targetIsOwner: true, memberCount: 1 }), 'allow');
  });

  it('someone who is not in the server neither removes nor is removed', () => {
    assert.equal(decideRemoval({ ...base, actorIsMember: false }), 'forbidden');
    assert.equal(decideRemoval({ ...base, targetIsMember: false }), 'not_member');
  });
});

describe('decideTransfer', () => {
  it('the owner hands the server to another member', () => {
    assert.equal(decideTransfer({ actorIsOwner: true, targetIsMember: true, isSelf: false }), 'allow');
  });

  it('only the owner transfers, and never to themselves', () => {
    assert.equal(decideTransfer({ actorIsOwner: false, targetIsMember: true, isSelf: false }), 'forbidden');
    assert.equal(decideTransfer({ actorIsOwner: true, targetIsMember: true, isSelf: true }), 'forbidden');
  });

  it('a target who left the server (e.g. removed mid-race) does not become owner', () => {
    assert.equal(decideTransfer({ actorIsOwner: true, targetIsMember: false, isSelf: false }), 'not_member');
  });
});
