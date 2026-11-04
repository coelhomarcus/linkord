import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callInviteRefusal } from '../../../src/modules/calls/callInvites.js';

const allowed = {
  inviterId: 'me', inviteeId: 'friend', channelType: 'voice',
  inviterInCall: true, inviteeIsMember: true, inviteeInCall: false,
};

describe('callInviteRefusal', () => {
  it('lets someone in a voice channel invite a member who can join it', () => {
    assert.equal(callInviteRefusal(allowed), null);
  });

  it('only voice channels take invites', () => {
    assert.equal(callInviteRefusal({ ...allowed, channelType: null }), 'not_found');
    assert.equal(callInviteRefusal({ ...allowed, channelType: 'direct' }), 'not_found');
    assert.equal(callInviteRefusal({ ...allowed, channelType: 'text' }), 'not_found');
  });

  it('the inviter has to be in the call', () => {
    assert.equal(callInviteRefusal({ ...allowed, inviterInCall: false }), 'not_in_call');
  });

  it('only members who can join the channel are invited, never yourself', () => {
    assert.equal(callInviteRefusal({ ...allowed, inviteeIsMember: false }), 'not_member');
    assert.equal(callInviteRefusal({ ...allowed, inviteeId: '' }), 'not_member');
    assert.equal(callInviteRefusal({ ...allowed, inviteeId: 'me' }), 'not_member');
  });

  it('someone already in the call is not invited again', () => {
    assert.equal(callInviteRefusal({ ...allowed, inviteeInCall: true }), 'already_in_call');
  });
});
