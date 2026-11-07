import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AppSocket, Participant } from '../../../src/types.js';
import { join, participants } from '../../../src/modules/presence/participants.js';
import { RING_MS, type DmCall } from '../../../src/modules/calls/dmCallMachine.js';
import {
  handlers, peekDmCallWelcome, restoreDmCalls, setDmCallStore, type DmCallStore,
} from '../../../src/modules/calls/dmCalls.js';

function fakeSocket(userId: string): AppSocket & { sent: { t: string }[] } {
  const sent: { t: string }[] = [];
  return {
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    sent,
    emit: (_event: string, payload: { t: string }) => { sent.push(payload); },
    disconnect: () => {},
    user: { tokenHash: 'x', userId, username: userId, displayName: '', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' },
  } as unknown as AppSocket & { sent: { t: string }[] };
}

function connect(userId: string, resume?: { id: string; token: string }): { participant: Participant; socket: AppSocket & { sent: { t: string }[] } } {
  const socket = fakeSocket(userId);
  const joined = join(socket, resume ?? {});
  assert.ok(joined);
  return { participant: joined.participant, socket };
}

let call: DmCall;
function dmCall(over: Partial<DmCall> = {}): DmCall {
  call = {
    id: `call-${Math.random()}`,
    conversationId: `dm-${Math.random()}`,
    callerId: `caller-${Math.random()}`,
    calleeId: `callee-${Math.random()}`,
    callerParticipantId: 'old-caller-seat',
    calleeParticipantId: null,
    video: false,
    phase: 'ringing',
    startedAt: Date.now(),
    answeredAt: null,
    ...over,
  };
  return call;
}

function recordingStore() {
  const events: string[] = [];
  const store: DmCallStore = {
    save: async (c) => { events.push(`save:${c.id}:${c.phase}`); },
    remove: async (id) => { events.push(`remove:${id}`); },
  };
  return { events, store };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  setDmCallStore(null);
  for (const p of [...participants.values()]) {
    if (p.graceTimer) clearTimeout(p.graceTimer);
    participants.delete(p.id);
  }
});

describe('restoreDmCalls', () => {
  it('an answered call reconnects its callee on the saved seat', () => {
    const active = dmCall({ phase: 'active', answeredAt: Date.now() - 5000 });
    const callee = connect(active.calleeId);
    restoreDmCalls([{ ...active, calleeParticipantId: callee.participant.id }]);

    const welcome = peekDmCallWelcome(callee.participant);
    assert.equal(welcome?.view.phase, 'active');
    assert.equal(welcome?.connect, true);
    assert.equal(welcome?.view.media, true);
  });

  it('a call restored twice is not duplicated', () => {
    const active = dmCall({ phase: 'active', answeredAt: Date.now() });
    const caller = connect(active.callerId);
    const restored = { ...active, callerParticipantId: caller.participant.id };
    restoreDmCalls([restored]);
    restoreDmCalls([restored]);

    const { events, store } = recordingStore();
    setDmCallStore(store);
    assert.equal(peekDmCallWelcome(caller.participant)?.view.callId, active.id);
    assert.deepEqual(events, []);
  });

  it('a ring that survived the restart seats the caller on its next connection', () => {
    const ringing = dmCall();
    restoreDmCalls([ringing]);

    const caller = connect(ringing.callerId);
    const welcome = peekDmCallWelcome(caller.participant);

    assert.equal(welcome?.view.phase, 'outgoing');
    assert.equal(ringing.callerParticipantId === 'old-caller-seat', false);
    const restored = peekDmCallWelcome(connect(ringing.calleeId).participant);
    assert.equal(restored?.view.phase, 'incoming');
  });

  it('a ring that ran out while the server was down ends as missed and is forgotten', async () => {
    const { events, store } = recordingStore();
    setDmCallStore(store);
    const stale = dmCall({ startedAt: Date.now() - RING_MS - 1000 });
    const callee = connect(stale.calleeId);
    callee.socket.sent.length = 0;

    restoreDmCalls([stale]);
    await settle();

    assert.ok(callee.socket.sent.some((message) => message.t === 'dm-call-ended'));
    assert.ok(events.includes(`remove:${stale.id}`));
    assert.equal(peekDmCallWelcome(callee.participant), null);
  });
});

describe('persistence of live calls', () => {
  it('a decline removes the stored call', async () => {
    const { events, store } = recordingStore();
    const ringing = dmCall();
    restoreDmCalls([ringing]);
    setDmCallStore(store);

    const callee = connect(ringing.calleeId);
    handlers['dm-call-decline']!(callee.socket, { callId: ringing.id });
    await settle();

    assert.deepEqual(events, [`remove:${ringing.id}`]);
  });

  it('accepting stores the answered call', async () => {
    const { events, store } = recordingStore();
    const ringing = dmCall();
    restoreDmCalls([ringing]);
    setDmCallStore(store);

    const callee = connect(ringing.calleeId);
    handlers['dm-call-accept']!(callee.socket, { callId: ringing.id });
    await settle();

    assert.ok(events.includes(`save:${ringing.id}:active`));
  });

  it('a store that fails does not stop the call', async () => {
    setDmCallStore({ save: async () => { throw new Error('db down'); }, remove: async () => { throw new Error('db down'); } });
    const ringing = dmCall();
    restoreDmCalls([ringing]);

    const callee = connect(ringing.calleeId);
    handlers['dm-call-decline']!(callee.socket, { callId: ringing.id });
    await settle();

    assert.equal(peekDmCallWelcome(connect(ringing.callerId).participant), null);
  });
});
