import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_DM_CALLS, RING_MS, TOMBSTONE_MS, acceptDmCall, cancelDmCall, declineDmCall, leaveDmCall, missDmCall,
  refusesImmediateJoin, startDmCall, type DmCallState,
} from '../../../src/modules/calls/dmCallMachine.js';

const now = 1_000_000;

function ring(state: DmCallState = EMPTY_DM_CALLS, over: Partial<Parameters<typeof startDmCall>[1]> = {}) {
  return startDmCall(state, {
    id: 'call-1', conversationId: 'dm-1', callerId: 'a', calleeId: 'b',
    callerParticipantId: 'pa', video: false, now, ...over,
  });
}

describe('dm call session', () => {
  it('starts ringing and repeats the same session for the same caller', () => {
    const started = ring();
    assert.equal(started.state.calls[0]?.phase, 'ringing');
    assert.equal(started.effects[0]?.type, 'state');
    assert.equal(started.effects[0]?.type === 'state' && started.effects[0].fresh, true);

    const again = ring(started.state);
    assert.equal(again.state.calls.length, 1);
    assert.equal(again.state.calls[0]?.id, 'call-1');
    assert.equal(again.effects[0]?.type === 'state' && again.effects[0].fresh, false);
    assert.equal(again.state.calls[0]?.startedAt, now);
  });

  it('treats the callee calling back as an accept', () => {
    const started = ring();
    const glare = startDmCall(started.state, {
      id: 'call-2', conversationId: 'dm-1', callerId: 'b', calleeId: 'a',
      callerParticipantId: 'pb', video: true, now: now + 10,
    });
    assert.equal(glare.state.calls[0]?.phase, 'active');
    assert.equal(glare.state.calls[0]?.id, 'call-1');
    assert.equal(glare.state.calls[0]?.calleeParticipantId, 'pb');
  });

  it('declines, cancels, and misses only while ringing', () => {
    const started = ring();
    const declined = declineDmCall(started.state, { callId: 'call-1', userId: 'b', now: now + 1 });
    assert.equal(declined.effects[0]?.type === 'ended' && declined.effects[0].reason, 'declined');
    assert.equal(declined.state.calls.length, 0);

    const cancelled = cancelDmCall(ring().state, { callId: 'call-1', userId: 'a', now: now + 1 });
    assert.equal(cancelled.effects[0]?.type === 'ended' && cancelled.effects[0].reason, 'cancelled');

    const early = missDmCall(ring().state, 'call-1', now + RING_MS - 1);
    assert.equal(early.effects.length, 0);
    assert.equal(early.state.calls.length, 1);
    const missed = missDmCall(ring().state, 'call-1', now + RING_MS);
    assert.equal(missed.effects[0]?.type === 'ended' && missed.effects[0].reason, 'missed');
  });

  it('a late event after the call ended does not reopen it', () => {
    const ended = cancelDmCall(ring().state, { callId: 'call-1', userId: 'a', now: now + 1 });
    const late = declineDmCall(ended.state, { callId: 'call-1', userId: 'b', now: now + 2 });
    assert.equal(late.code, 'ended');
    assert.equal(late.reason, 'cancelled');
    assert.equal(late.effects.length, 0);
    assert.equal(late.state.calls.length, 0);

    const forgotten = declineDmCall(ended.state, { callId: 'call-1', userId: 'b', now: now + TOMBSTONE_MS + 5 });
    assert.equal(forgotten.code, 'gone');
    assert.equal(forgotten.state.calls.length, 0);
  });

  it('an active DM ends when one side leaves, and a ring does not', () => {
    const started = ring();
    assert.equal(leaveDmCall(started.state, { conversationId: 'dm-1', userId: 'a', now: now + 1 }).effects.length, 0);

    const accepted = acceptDmCall(started.state, { callId: 'call-1', userId: 'b', participantId: 'pb', now: now + 1 });
    const left = leaveDmCall(accepted.state, { conversationId: 'dm-1', userId: 'a', now: now + 2 });
    assert.equal(left.effects[0]?.type === 'ended' && left.effects[0].reason, 'ended');
    assert.equal(left.state.calls.length, 0);
  });

  it('refuses a second call from someone already in one, and accepting a new ring ends the previous', () => {
    const first = ring();
    const busy = startDmCall(first.state, {
      id: 'call-2', conversationId: 'dm-2', callerId: 'a', calleeId: 'c',
      callerParticipantId: 'pa', video: false, now: now + 1,
    });
    assert.equal(busy.code, 'busy');
    assert.equal(busy.state.calls.length, 1);

    const active = acceptDmCall(first.state, { callId: 'call-1', userId: 'b', participantId: 'pb', now: now + 1 });
    const incoming = startDmCall(active.state, {
      id: 'call-2', conversationId: 'dm-2', callerId: 'c', calleeId: 'a',
      callerParticipantId: 'pc', video: false, now: now + 2,
    });
    assert.equal(incoming.state.calls.length, 2);
    const accepted = acceptDmCall(incoming.state, { callId: 'call-2', userId: 'a', participantId: 'pa2', now: now + 3 });
    assert.equal(accepted.state.calls.length, 1);
    assert.equal(accepted.state.calls[0]?.id, 'call-2');
    assert.equal(accepted.state.calls[0]?.phase, 'active');
    assert.equal(accepted.effects.some((effect) => effect.type === 'ended' && effect.callId === 'call-1'), true);
  });

  it('keeps an immediate join for voice channels and refuses it for a DM', () => {
    assert.equal(refusesImmediateJoin('direct'), true);
    assert.equal(refusesImmediateJoin('voice'), false);
    assert.equal(refusesImmediateJoin('text'), false);
  });
});
