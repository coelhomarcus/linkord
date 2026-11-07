import { config } from '../../config/env.js';
import * as livekit from '../../integrations/livekit/livekit.js';
import { logger } from '../../lib/logger.js';
import { ERROR_CODES } from '../../http/errors.js';
import type { AppSocket, HandlerTable, Participant } from '../../types.js';
import { getConversationForUser, getDirectPeerId } from '../conversations/conversationsRepository.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { PERMISSIONS } from '../servers/permissions.js';
import {
  isUserOnline, participants, send, sendSocketError, setCallConversationId, setParticipantRemovedHook,
} from '../presence/participants.js';
import {
  EMPTY_DM_CALLS, RING_MS, acceptDmCall, activeFor, callBetween, cancelDmCall, declineDmCall, failDmCall,
  leaveDmCall, missDmCall, ringingFor, startDmCall,
  type DmCall, type DmCallEffect, type DmCallEndReason, type DmCallState, type DmCallStep,
} from './dmCallMachine.js';

const log = logger.child({ component: 'dm-call' });

let state: DmCallState = EMPTY_DM_CALLS;
const timers = new Map<string, NodeJS.Timeout>();

export interface DmCallView {
  callId: string;
  conversationId: string;
  video: boolean;
  phase: 'outgoing' | 'incoming' | 'active';
  callerId: string;
  peerId: string;
  startedAt: number;
  media: boolean;
}

function viewFor(call: DmCall, userId: string, media: boolean): DmCallView {
  const phase = call.phase === 'active' ? 'active' : call.callerId === userId ? 'outgoing' : 'incoming';
  return {
    callId: call.id,
    conversationId: call.conversationId,
    video: call.video,
    phase,
    callerId: call.callerId,
    peerId: call.callerId === userId ? call.calleeId : call.callerId,
    startedAt: call.startedAt,
    media: phase === 'active' && media,
  };
}

function mediaFor(call: DmCall, participantId: string): boolean {
  return call.phase === 'active' && (participantId === call.callerParticipantId || participantId === call.calleeParticipantId);
}

function notify(call: DmCall): void {
  for (const participant of participants.values()) {
    if (participant.userId !== call.callerId && participant.userId !== call.calleeId) continue;
    send(participant.socket, { t: 'dm-call', ...viewFor(call, participant.userId, mediaFor(call, participant.id)) });
  }
}

function clearCallFlags(conversationId: string, callerId: string, calleeId: string): void {
  for (const participant of participants.values()) {
    if (participant.callConversationId !== conversationId) continue;
    if (participant.userId !== callerId && participant.userId !== calleeId) continue;
    setCallConversationId(participant, null);
  }
}

function clearTimer(callId: string): void {
  const timer = timers.get(callId);
  if (!timer) return;
  clearTimeout(timer);
  timers.delete(callId);
}

function armTimer(call: DmCall): void {
  clearTimer(call.id);
  const wait = Math.max(0, call.startedAt + RING_MS - Date.now());
  const timer = setTimeout(() => {
    timers.delete(call.id);
    apply(missDmCall(state, call.id, Date.now()));
  }, wait);
  timer.unref();
  timers.set(call.id, timer);
}

async function mint(call: DmCall, participant: Participant): Promise<boolean> {
  try {
    const livekitToken = await livekit.createToken(participant, livekit.roomNameFor(call.conversationId));
    if (participant.callConversationId !== call.conversationId) setCallConversationId(participant, call.conversationId);
    send(participant.socket, { t: 'call-token', conversationId: call.conversationId, livekitUrl: config.LIVEKIT_URL, livekitToken });
    return true;
  } catch (err) {
    log.warn('failed to generate LiveKit token', { participantId: participant.id, err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function connectParties(call: DmCall): Promise<void> {
  const holders = [...participants.values()].filter((participant) => mediaFor(call, participant.id) && participant.socket);
  const results = await Promise.all(holders.map((participant) => mint(call, participant)));
  if (holders.length > 0 && results.some((ok) => !ok)) apply(failDmCall(state, call.id, Date.now()));
}

function apply(step: DmCallStep): DmCallStep {
  state = step.state;
  for (const effect of step.effects) dispatch(effect);
  return step;
}

function dispatch(effect: DmCallEffect): void {
  if (effect.type === 'ended') {
    clearTimer(effect.callId);
    clearCallFlags(effect.conversationId, effect.callerId, effect.calleeId);
    const message = { t: 'dm-call-ended', callId: effect.callId, conversationId: effect.conversationId, reason: effect.reason };
    for (const userId of [effect.callerId, effect.calleeId]) {
      for (const participant of participants.values()) {
        if (participant.userId === userId) send(participant.socket, message);
      }
    }
    return;
  }
  notify(effect.call);
  if (effect.call.phase === 'ringing' && effect.fresh) armTimer(effect.call);
  if (effect.call.phase === 'active') {
    clearTimer(effect.call.id);
    if (effect.fresh) void connectParties(effect.call);
  }
}

function replayEnded(socket: Participant['socket'], callId: string, reason: DmCallEndReason): void {
  const prior = state.tombstones.find((entry) => entry.id === callId);
  send(socket, { t: 'dm-call-ended', callId, conversationId: prior?.conversationId ?? '', reason });
}

async function handleStart(socket: AppSocket, msg: { conversationId?: string; video?: boolean }): Promise<void> {
  const participant = participants.get(socket.participantId ?? '');
  if (!participant || participant.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const conversation = await getConversationForUser(conversationId, participant.userId, PERMISSIONS.CONNECT);
  if (!conversation || conversation.type !== 'direct') {
    sendSocketError(socket, 'call-not-allowed', 'Você não tem acesso a essa conversa.');
    return;
  }
  const peerId = await getDirectPeerId(conversationId, participant.userId);
  if (!peerId || !(await canSendDirectMessage(participant.userId, peerId))) {
    sendSocketError(socket, ERROR_CODES.relationshipRequired, 'Vocês precisam ser amigos pra iniciar essa chamada.');
    return;
  }
  const step = apply(startDmCall(state, {
    id: crypto.randomUUID(),
    conversationId,
    callerId: participant.userId,
    calleeId: peerId,
    callerParticipantId: participant.id,
    video: msg.video === true,
    now: Date.now(),
  }));
  if (step.code === 'busy') sendSocketError(socket, 'conflict', 'Você já está numa chamada privada.');
}

function partyAction(socket: AppSocket, callId: string, run: (participant: Participant, id: string) => DmCallStep): void {
  const participant = participants.get(socket.participantId ?? '');
  if (!participant || participant.socket !== socket || !callId) return;
  const step = apply(run(participant, callId));
  if (step.code === 'ended' && step.reason) replayEnded(socket, callId, step.reason);
}

function handleAccept(socket: AppSocket, msg: { callId?: string }): void {
  partyAction(socket, String(msg.callId || ''), (participant, callId) => acceptDmCall(state, {
    callId, userId: participant.userId, participantId: participant.id, now: Date.now(),
  }));
}

function handleDecline(socket: AppSocket, msg: { callId?: string }): void {
  partyAction(socket, String(msg.callId || ''), (participant, callId) => declineDmCall(state, {
    callId, userId: participant.userId, now: Date.now(),
  }));
}

function handleCancel(socket: AppSocket, msg: { callId?: string }): void {
  partyAction(socket, String(msg.callId || ''), (participant, callId) => cancelDmCall(state, {
    callId, userId: participant.userId, now: Date.now(),
  }));
}

export function leaveActiveDmCall(userId: string, conversationId: string): void {
  apply(leaveDmCall(state, { conversationId, userId, now: Date.now() }));
}

/** A block or an unfriend drops the ring along with the media room. */
export function endDmCallBetween(a: string, b: string): void {
  const call = callBetween(state, a, b);
  if (!call) return;
  apply(call.phase === 'ringing'
    ? cancelDmCall(state, { callId: call.id, userId: call.callerId, now: Date.now() })
    : leaveDmCall(state, { conversationId: call.conversationId, userId: a, now: Date.now() }));
}

/** The ring wins the card. An active call on the same account still reconnects when no other tab holds it. */
export function peekDmCallWelcome(participant: Participant): { view: DmCallView; connect: boolean } | null {
  const ringing = ringingFor(state, participant.userId);
  const active = activeFor(state, participant.userId);
  const shown = ringing ?? active;
  if (!shown) return null;
  const connect = !!active && !anotherTabHolds(participant, active.conversationId) && !seatTakenByOther(active, participant);
  if (connect && active) {
    if (active.callerId === participant.userId) active.callerParticipantId = participant.id;
    else active.calleeParticipantId = participant.id;
  }
  return { view: viewFor(shown, participant.userId, shown.phase === 'active' && connect), connect };
}

function anotherTabHolds(participant: Participant, conversationId: string): boolean {
  for (const other of participants.values()) {
    if (other.id === participant.id || other.userId !== participant.userId) continue;
    if (other.socket?.connected && other.callConversationId === conversationId) return true;
  }
  return false;
}

/** The tab that accepted or placed the call keeps the media seat while its socket is up. */
function seatTakenByOther(call: DmCall, participant: Participant): boolean {
  const holderId = call.callerId === participant.userId ? call.callerParticipantId : call.calleeParticipantId;
  if (!holderId || holderId === participant.id) return false;
  const holder = participants.get(holderId);
  return !!holder?.socket?.connected && holder.userId === participant.userId;
}

/** Tell this tab to arm, then mint. Welcome already carried the card; the token has to follow it. */
export async function finishDmCallWelcome(participant: Participant): Promise<void> {
  const call = activeFor(state, participant.userId);
  if (!call || !mediaFor(call, participant.id) || anotherTabHolds(participant, call.conversationId) || seatTakenByOther(call, participant)) return;
  send(participant.socket, { t: 'dm-call', ...viewFor(call, participant.userId, true) });
  const ok = await mint(call, participant);
  if (!ok) apply(failDmCall(state, call.id, Date.now()));
}

setParticipantRemovedHook((participant) => {
  const ringing = ringingFor(state, participant.userId);
  if (ringing && participant.userId === ringing.callerId && participant.id === ringing.callerParticipantId && !isUserOnline(participant.userId)) {
    apply(cancelDmCall(state, { callId: ringing.id, userId: ringing.callerId, now: Date.now() }));
  }
  if (participant.callConversationId) {
    const active = activeFor(state, participant.userId);
    if (active && active.conversationId === participant.callConversationId && !anotherTabHolds(participant, active.conversationId)) {
      apply(leaveDmCall(state, { conversationId: active.conversationId, userId: participant.userId, now: Date.now() }));
    }
  }
});

export const handlers: HandlerTable = {
  'dm-call-start': handleStart,
  'dm-call-accept': handleAccept,
  'dm-call-decline': handleDecline,
  'dm-call-cancel': handleCancel,
};
