import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, DmCallEndReason, DmCallView } from '@/shared/types/protocol';

export interface DmCallNotice {
  callId: string;
  conversationId: string;
  video: boolean;
  phase: 'outgoing' | 'incoming' | 'ended';
  callerId: string;
  peerId: string;
  reason?: DmCallEndReason;
}

interface DmCallDeps {
  /** false when the socket is down and the message went nowhere */
  sendWs: (msg: ClientMessage) => boolean | void;
  armDmMedia: (conversationId: string, video: boolean) => void;
  leaveCall: () => Promise<void>;
  dropPendingCall: (conversationId: string) => void;
  activeCallId: () => string | null;
  myUserId: () => string | null;
}

interface UnsentAnswer {
  t: 'dm-call-accept' | 'dm-call-decline' | 'dm-call-cancel';
  callId: string;
}

function noticeFrom(view: DmCallView, phase: DmCallNotice['phase'], reason?: DmCallEndReason): DmCallNotice {
  return {
    callId: view.callId,
    conversationId: view.conversationId,
    video: view.video,
    phase,
    callerId: view.callerId,
    peerId: view.peerId,
    reason,
  };
}

export function useDmCall(deps: DmCallDeps) {
  const depsRef = useRef(deps);
  const [notice, setNotice] = useState<DmCallNotice | null>(null);
  const noticeRef = useRef(notice);
  const [started, setStarted] = useState<{ conversationId: string; at: number } | null>(null);
  const [stageConversationId, setStageConversationId] = useState<string | null>(null);
  useEffect(() => {
    depsRef.current = deps;
    noticeRef.current = notice;
  });
  const startAttemptRef = useRef<string | null>(null);
  // An answer given while the socket was down (a redeploy, a network blip):
  // clicking "Atender" then must not be lost without a word.
  const unsentAnswerRef = useRef<UnsentAnswer | null>(null);

  const clearStage = useCallback(() => setStageConversationId(null), []);

  const onDmCall = useCallback((view: DmCallView) => {
    if (view.conversationId === startAttemptRef.current) startAttemptRef.current = null;
    const { armDmMedia, activeCallId, myUserId } = depsRef.current;
    if (view.phase === 'active') {
      if (view.media) {
        const already = activeCallId() === view.conversationId;
        armDmMedia(view.conversationId, view.video && view.callerId === myUserId());
        setStarted({ conversationId: view.conversationId, at: view.startedAt });
        if (!already) setStageConversationId(view.conversationId);
      }
      setNotice((current) => current?.callId === view.callId ? null : current);
      return;
    }
    setNotice(noticeFrom(view, view.phase));
  }, []);

  const onEnded = useCallback((msg: { callId: string; conversationId: string; reason: DmCallEndReason }) => {
    if (unsentAnswerRef.current?.callId === msg.callId) unsentAnswerRef.current = null;
    const { leaveCall, dropPendingCall, activeCallId } = depsRef.current;
    if (activeCallId() === msg.conversationId) void leaveCall();
    else dropPendingCall(msg.conversationId);
    setStarted((current) => current?.conversationId === msg.conversationId ? null : current);
    setNotice((current) => {
      const ours = current?.callId === msg.callId;
      if ((ours && current.phase !== 'ended') || msg.reason === 'failed') {
        return {
          callId: msg.callId,
          conversationId: msg.conversationId,
          video: current?.video ?? false,
          phase: 'ended',
          callerId: current?.callerId ?? '',
          peerId: current?.peerId ?? '',
          reason: msg.reason,
        };
      }
      return ours ? null : current;
    });
  }, []);

  useEffect(() => {
    if (notice?.phase !== 'ended') return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const startDmCall = useCallback((conversationId: string, video: boolean) => {
    startAttemptRef.current = conversationId;
    depsRef.current.sendWs({ t: 'dm-call-start', conversationId, video });
  }, []);

  const answer = useCallback((t: UnsentAnswer['t'], callId: string) => {
    const sent = depsRef.current.sendWs({ t, callId });
    unsentAnswerRef.current = sent === false ? { t, callId } : null;
  }, []);

  const acceptDmCall = useCallback(() => {
    const current = noticeRef.current;
    if (current?.phase === 'incoming') answer('dm-call-accept', current.callId);
  }, [answer]);

  const declineDmCall = useCallback(() => {
    const current = noticeRef.current;
    if (current?.phase === 'incoming') answer('dm-call-decline', current.callId);
  }, [answer]);

  const cancelDmCall = useCallback(() => {
    const current = noticeRef.current;
    if (current?.phase === 'outgoing') answer('dm-call-cancel', current.callId);
  }, [answer]);

  /** After every welcome, with the call it carries (if any): an answer that never
   * left goes out now, but only to the same call still waiting for it. A call
   * that ended or was answered elsewhere meanwhile drops it. */
  const onReconnected = useCallback((view: DmCallView | null) => {
    const unsent = unsentAnswerRef.current;
    unsentAnswerRef.current = null;
    if (!unsent || !view || view.callId !== unsent.callId) return;
    const waiting = unsent.t === 'dm-call-cancel' ? view.phase === 'outgoing' : view.phase === 'incoming';
    if (waiting) answer(unsent.t, unsent.callId);
  }, [answer]);

  const consumeStartAttempt = useCallback((): string | null => {
    const conversationId = startAttemptRef.current;
    startAttemptRef.current = null;
    return conversationId;
  }, []);

  return {
    dmCall: notice,
    dmStartedAt: started && deps.activeCallId() === started.conversationId ? started.at : null,
    dmStageConversationId: stageConversationId,
    clearDmStage: clearStage,
    startDmCall,
    acceptDmCall,
    declineDmCall,
    cancelDmCall,
    onDmCall,
    onEnded,
    onReconnected,
    consumeStartAttempt,
  };
}
