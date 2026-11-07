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
  sendWs: (msg: ClientMessage) => void;
  armDmMedia: (conversationId: string, video: boolean) => void;
  leaveCall: () => Promise<void>;
  dropPendingCall: (conversationId: string) => void;
  activeCallId: () => string | null;
  myUserId: () => string | null;
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

  const acceptDmCall = useCallback(() => {
    const current = noticeRef.current;
    if (current?.phase === 'incoming') depsRef.current.sendWs({ t: 'dm-call-accept', callId: current.callId });
  }, []);

  const declineDmCall = useCallback(() => {
    const current = noticeRef.current;
    if (current?.phase === 'incoming') depsRef.current.sendWs({ t: 'dm-call-decline', callId: current.callId });
  }, []);

  const cancelDmCall = useCallback(() => {
    const current = noticeRef.current;
    if (current?.phase === 'outgoing') depsRef.current.sendWs({ t: 'dm-call-cancel', callId: current.callId });
  }, []);

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
    consumeStartAttempt,
  };
}
