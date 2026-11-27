import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canMoveInCall } from '../../../src/modules/moderation/moderation.js';

const member = { actorCanMove: true, actorCanConnectToDestination: true, actorOutranksTarget: true, targetCanConnectToDestination: true };

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

  it('nobody is moved into a channel they could not join themselves', () => {
    assert.equal(canMoveInCall({ ...member, targetCanConnectToDestination: false }), false);
  });
});
