export const RING_MS = 40_000;
export const TOMBSTONE_MS = 30_000;

export type DmCallEndReason = 'declined' | 'cancelled' | 'missed' | 'ended' | 'failed';

export interface DmCall {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerParticipantId: string;
  calleeParticipantId: string | null;
  video: boolean;
  phase: 'ringing' | 'active';
  startedAt: number;
  /** Set when the callee answers. Talk time is measured from here, not from the ring. */
  answeredAt: number | null;
}

export interface DmCallTombstone {
  id: string;
  conversationId: string;
  reason: DmCallEndReason;
  endedAt: number;
}

export interface DmCallState {
  calls: DmCall[];
  tombstones: DmCallTombstone[];
}

export const EMPTY_DM_CALLS: DmCallState = { calls: [], tombstones: [] };

export type DmCallEffect =
  | { type: 'state'; call: DmCall; fresh: boolean }
  | {
    type: 'ended';
    callId: string;
    conversationId: string;
    callerId: string;
    calleeId: string;
    reason: DmCallEndReason;
    /** Whole seconds of talk time. Null when the call was never answered. */
    durationSeconds: number | null;
  };

export interface DmCallStep {
  state: DmCallState;
  effects: DmCallEffect[];
  code?: 'busy' | 'gone' | 'not-party' | 'ended';
  reason?: DmCallEndReason;
}

function prune(state: DmCallState, now: number): DmCallState {
  const tombstones = state.tombstones.filter((entry) => now - entry.endedAt < TOMBSTONE_MS);
  return tombstones.length === state.tombstones.length ? state : { ...state, tombstones };
}

function isParty(call: DmCall, userId: string): boolean {
  return call.callerId === userId || call.calleeId === userId;
}

function talkSeconds(call: DmCall, now: number): number | null {
  if (call.answeredAt == null) return null;
  return Math.max(1, Math.floor((now - call.answeredAt) / 1000));
}

function endOne(state: DmCallState, call: DmCall, reason: DmCallEndReason, now: number): { state: DmCallState; effect: Extract<DmCallEffect, { type: 'ended' }> } {
  return {
    state: {
      calls: state.calls.filter((entry) => entry.id !== call.id),
      tombstones: [...state.tombstones, { id: call.id, conversationId: call.conversationId, reason, endedAt: now }],
    },
    effect: {
      type: 'ended', callId: call.id, conversationId: call.conversationId,
      callerId: call.callerId, calleeId: call.calleeId, reason,
      durationSeconds: talkSeconds(call, now),
    },
  };
}

/** Drop every other DM this person is in. Accepting a new ring leaves the previous one. */
function endOthers(state: DmCallState, userId: string, keepId: string, now: number): { state: DmCallState; effects: DmCallEffect[] } {
  let current = state;
  const effects: DmCallEffect[] = [];
  for (const call of state.calls) {
    if (call.id === keepId || !isParty(call, userId)) continue;
    const step = endOne(current, call, 'ended', now);
    current = step.state;
    effects.push(step.effect);
  }
  return { state: current, effects };
}

function tombstone(state: DmCallState, callId: string): DmCallTombstone | undefined {
  return state.tombstones.find((entry) => entry.id === callId);
}

function gone(state: DmCallState, callId: string): DmCallStep {
  const prior = tombstone(state, callId);
  if (!prior) return { state, effects: [], code: 'gone' };
  return { state, effects: [], code: 'ended', reason: prior.reason };
}

export function startDmCall(state: DmCallState, input: {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerParticipantId: string;
  video: boolean;
  now: number;
}): DmCallStep {
  const pruned = prune(state, input.now);
  const existing = pruned.calls.find((call) => call.conversationId === input.conversationId);
  if (existing) {
    if (existing.callerId === input.callerId) return { state: pruned, effects: [{ type: 'state', call: existing, fresh: false }] };
    // Both pressed call: the one already being rung is answering.
    if (existing.calleeId === input.callerId && existing.phase === 'ringing') {
      return acceptDmCall(pruned, { callId: existing.id, userId: input.callerId, participantId: input.callerParticipantId, now: input.now });
    }
    if (existing.calleeId === input.callerId && existing.phase === 'active') {
      return { state: pruned, effects: [{ type: 'state', call: existing, fresh: false }] };
    }
  }
  if (pruned.calls.some((call) => isParty(call, input.callerId))) return { state: pruned, effects: [], code: 'busy' };
  const call: DmCall = {
    id: input.id,
    conversationId: input.conversationId,
    callerId: input.callerId,
    calleeId: input.calleeId,
    callerParticipantId: input.callerParticipantId,
    calleeParticipantId: null,
    video: input.video,
    phase: 'ringing',
    startedAt: input.now,
    answeredAt: null,
  };
  return { state: { ...pruned, calls: [...pruned.calls, call] }, effects: [{ type: 'state', call, fresh: true }] };
}

export function acceptDmCall(state: DmCallState, input: {
  callId: string;
  userId: string;
  participantId: string;
  now: number;
}): DmCallStep {
  const pruned = prune(state, input.now);
  const call = pruned.calls.find((entry) => entry.id === input.callId);
  if (!call) return gone(pruned, input.callId);
  if (call.calleeId !== input.userId) return { state: pruned, effects: [], code: 'not-party' };
  if (call.phase === 'active') return { state: pruned, effects: [{ type: 'state', call, fresh: false }] };
  const dropped = endOthers(pruned, input.userId, call.id, input.now);
  const accepted: DmCall = {
    ...call,
    phase: 'active',
    calleeParticipantId: input.participantId,
    answeredAt: call.answeredAt ?? input.now,
  };
  return {
    state: { ...dropped.state, calls: dropped.state.calls.map((entry) => entry.id === call.id ? accepted : entry) },
    effects: [...dropped.effects, { type: 'state', call: accepted, fresh: true }],
  };
}

export function declineDmCall(state: DmCallState, input: { callId: string; userId: string; now: number }): DmCallStep {
  const pruned = prune(state, input.now);
  const call = pruned.calls.find((entry) => entry.id === input.callId);
  if (!call) return gone(pruned, input.callId);
  if (call.calleeId !== input.userId || call.phase !== 'ringing') return { state: pruned, effects: [], code: 'not-party' };
  const step = endOne(pruned, call, 'declined', input.now);
  return { state: step.state, effects: [step.effect] };
}

export function cancelDmCall(state: DmCallState, input: { callId: string; userId: string; now: number }): DmCallStep {
  const pruned = prune(state, input.now);
  const call = pruned.calls.find((entry) => entry.id === input.callId);
  if (!call) return gone(pruned, input.callId);
  if (call.callerId !== input.userId || call.phase !== 'ringing') return { state: pruned, effects: [], code: 'not-party' };
  const step = endOne(pruned, call, 'cancelled', input.now);
  return { state: step.state, effects: [step.effect] };
}

export function missDmCall(state: DmCallState, callId: string, now: number): DmCallStep {
  const pruned = prune(state, now);
  const call = pruned.calls.find((entry) => entry.id === callId);
  if (!call || call.phase !== 'ringing') return { state: pruned, effects: [] };
  if (now - call.startedAt < RING_MS) return { state: pruned, effects: [] };
  const step = endOne(pruned, call, 'missed', now);
  return { state: step.state, effects: [step.effect] };
}

/** One side of an active DM hung up. A ringing call is left for cancel or the timeout. */
export function leaveDmCall(state: DmCallState, input: { conversationId: string; userId: string; now: number }): DmCallStep {
  const pruned = prune(state, input.now);
  const call = pruned.calls.find((entry) => entry.conversationId === input.conversationId && entry.phase === 'active' && isParty(entry, input.userId));
  if (!call) return { state: pruned, effects: [] };
  const step = endOne(pruned, call, 'ended', input.now);
  return { state: step.state, effects: [step.effect] };
}

export function failDmCall(state: DmCallState, callId: string, now: number): DmCallStep {
  const pruned = prune(state, now);
  const call = pruned.calls.find((entry) => entry.id === callId);
  if (!call) return { state: pruned, effects: [] };
  const step = endOne(pruned, call, 'failed', now);
  return { state: step.state, effects: [step.effect] };
}

/** A direct conversation never joins the media room ahead of the ring. Voice channels do. */
export function refusesImmediateJoin(type: string): boolean {
  return type === 'direct';
}

export function ringingFor(state: DmCallState, userId: string): DmCall | null {
  return state.calls.find((call) => call.phase === 'ringing' && isParty(call, userId)) ?? null;
}

export function activeFor(state: DmCallState, userId: string): DmCall | null {
  return state.calls.find((call) => call.phase === 'active' && isParty(call, userId)) ?? null;
}

export function callBetween(state: DmCallState, a: string, b: string): DmCall | null {
  return state.calls.find((call) => (
    (call.callerId === a && call.calleeId === b) || (call.callerId === b && call.calleeId === a)
  )) ?? null;
}
