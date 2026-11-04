import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canMoveInCall } from '../../../src/modules/moderation/moderation.js';

const member = { actorIsAdmin: false, actorCanMove: true, actorCanConnectToDestination: true, actorOutranksTarget: true, targetCanConnectToDestination: true };

describe('canMoveInCall', () => {
  it('MOVE_MEMBERS where they are and a way into the destination moves someone below', () => {
    assert.equal(canMoveInCall(member), true);
  });

  it('without MOVE_MEMBERS nobody is moved', () => {
    assert.equal(canMoveInCall({ ...member, actorCanMove: false }), false);
  });

  it('nobody is moved into a channel the actor cannot connect to', () => {
    assert.equal(canMoveInCall({ ...member, actorCanConnectToDestination: false }), false);
  });

  it('the permission does not reach someone at or above the actor', () => {
    assert.equal(canMoveInCall({ ...member, actorOutranksTarget: false }), false);
  });

  it('nobody is moved into a channel they could not join themselves, not even by an admin', () => {
    assert.equal(canMoveInCall({ ...member, targetCanConnectToDestination: false }), false);
    assert.equal(canMoveInCall({ ...member, actorIsAdmin: true, targetCanConnectToDestination: false }), false);
  });

  it('an instance admin keeps the power, as an audited action', () => {
    assert.equal(canMoveInCall({ actorIsAdmin: true, actorCanMove: false, actorCanConnectToDestination: false, actorOutranksTarget: false, targetCanConnectToDestination: true }), true);
  });
});
