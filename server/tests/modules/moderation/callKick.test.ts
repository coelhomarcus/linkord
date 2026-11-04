import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canKickFromCall } from '../../../src/modules/moderation/moderation.js';

describe('canKickFromCall', () => {
  it('MOVE_MEMBERS in the channel disconnects someone below in the hierarchy', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorCanMove: true, actorOutranksTarget: true }), true);
  });

  it('the permission does not reach someone at or above the actor', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorCanMove: true, actorOutranksTarget: false }), false);
  });

  it('without MOVE_MEMBERS nobody is disconnected', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorCanMove: false, actorOutranksTarget: true }), false);
  });

  it('an instance admin keeps the power, as an audited action', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: true, actorCanMove: false, actorOutranksTarget: false }), true);
  });
});
