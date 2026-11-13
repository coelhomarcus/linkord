import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDmCall } from '@/features/calls/useDmCall';
import type { DmCallView } from '@/shared/types/protocol';

function setup(myUserId = 'me') {
  const sendWs = vi.fn();
  const armDmMedia = vi.fn();
  const leaveCall = vi.fn(async () => undefined);
  const dropPendingCall = vi.fn();
  const { result } = renderHook(() => useDmCall({
    sendWs, armDmMedia, leaveCall, dropPendingCall,
    activeCallId: () => null,
    myUserId: () => myUserId,
  }));
  return { result, sendWs, armDmMedia, leaveCall, dropPendingCall };
}

const incoming: DmCallView = {
  callId: 'k', conversationId: 'c1', video: true, phase: 'incoming',
  callerId: 'peer', peerId: 'peer', startedAt: 1, media: false,
};

describe('useDmCall', () => {
  it('accepting sends the answer and only the active message connects', () => {
    const { result, sendWs, armDmMedia } = setup('me');
    act(() => result.current.onDmCall(incoming));
    act(() => result.current.acceptDmCall());
    expect(sendWs).toHaveBeenCalledWith({ t: 'dm-call-accept', callId: 'k' });
    expect(armDmMedia).not.toHaveBeenCalled();

    act(() => result.current.onDmCall({ ...incoming, phase: 'active', media: true }));
    expect(armDmMedia).toHaveBeenCalledWith('c1', false);
  });

  it('the caller starts the camera only when they placed a video call', () => {
    const { result, armDmMedia } = setup('me');
    act(() => result.current.onDmCall({
      ...incoming, phase: 'active', media: true, callerId: 'me', peerId: 'peer', video: true,
    }));
    expect(armDmMedia).toHaveBeenCalledWith('c1', true);
  });

  it('declining and cancelling do not connect', () => {
    const incomingCall = setup();
    act(() => incomingCall.result.current.onDmCall(incoming));
    act(() => incomingCall.result.current.declineDmCall());
    expect(incomingCall.sendWs).toHaveBeenCalledWith({ t: 'dm-call-decline', callId: 'k' });
    expect(incomingCall.armDmMedia).not.toHaveBeenCalled();

    const outgoing = setup();
    act(() => outgoing.result.current.onDmCall({ ...incoming, phase: 'outgoing', callerId: 'me', peerId: 'peer' }));
    act(() => outgoing.result.current.cancelDmCall());
    expect(outgoing.sendWs).toHaveBeenCalledWith({ t: 'dm-call-cancel', callId: 'k' });
    expect(outgoing.armDmMedia).not.toHaveBeenCalled();
  });

  describe('when a call ends', () => {
    it('clears the ringing notice, since the DM records the call', () => {
      for (const reason of ['declined', 'cancelled', 'missed', 'ended'] as const) {
        const { result } = setup();
        act(() => result.current.onDmCall(incoming));
        act(() => result.current.onEnded({ callId: 'k', conversationId: 'c1', reason }));
        expect(result.current.dmCall).toBeNull();
      }
    });

    it('keeps a failure on screen until it is dismissed', () => {
      vi.useFakeTimers();
      try {
        const { result } = setup();
        act(() => result.current.onDmCall(incoming));
        act(() => result.current.onEnded({ callId: 'k', conversationId: 'c1', reason: 'failed' }));
        expect(result.current.dmCall).toMatchObject({ phase: 'ended', reason: 'failed', peerId: 'peer' });
        act(() => vi.advanceTimersByTime(60_000));
        expect(result.current.dmCall?.reason).toBe('failed');
        act(() => result.current.dismissDmCallNotice());
        expect(result.current.dmCall).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failure of another call does not replace one that is ringing', () => {
      const { result } = setup();
      act(() => result.current.onDmCall(incoming));
      act(() => result.current.onEnded({ callId: 'other', conversationId: 'c2', reason: 'failed' }));
      expect(result.current.dmCall).toMatchObject({ callId: 'k', phase: 'incoming' });
      act(() => result.current.dismissDmCallNotice());
      expect(result.current.dmCall?.phase).toBe('incoming');
    });
  });

  describe('an answer given while the socket is down', () => {
    function offline() {
      const harness = setup();
      harness.sendWs.mockReturnValue(false);
      act(() => harness.result.current.onDmCall(incoming));
      return harness;
    }

    it('accepting offline goes out after the reconnect, to the call still ringing', () => {
      const { result, sendWs } = offline();
      act(() => result.current.acceptDmCall());
      expect(sendWs).toHaveBeenCalledTimes(1);

      sendWs.mockReturnValue(true);
      act(() => result.current.onDmCall(incoming));
      act(() => result.current.onReconnected(incoming));
      expect(sendWs).toHaveBeenCalledTimes(2);
      expect(sendWs).toHaveBeenLastCalledWith({ t: 'dm-call-accept', callId: 'k' });
    });

    it('is dropped when the reconnect brings no call, or another one', () => {
      const gone = offline();
      act(() => gone.result.current.acceptDmCall());
      gone.sendWs.mockReturnValue(true);
      act(() => gone.result.current.onReconnected(null));
      expect(gone.sendWs).toHaveBeenCalledTimes(1);

      const other = offline();
      act(() => other.result.current.declineDmCall());
      other.sendWs.mockReturnValue(true);
      act(() => other.result.current.onReconnected({ ...incoming, callId: 'another' }));
      expect(other.sendWs).toHaveBeenCalledTimes(1);
    });

    it('is dropped when the call already became active or ended meanwhile', () => {
      const active = offline();
      act(() => active.result.current.acceptDmCall());
      active.sendWs.mockReturnValue(true);
      act(() => active.result.current.onReconnected({ ...incoming, phase: 'active', media: true }));
      expect(active.sendWs).toHaveBeenCalledTimes(1);

      const ended = offline();
      act(() => ended.result.current.acceptDmCall());
      act(() => ended.result.current.onEnded({ callId: 'k', conversationId: 'c1', reason: 'cancelled' }));
      ended.sendWs.mockReturnValue(true);
      act(() => ended.result.current.onReconnected(incoming));
      expect(ended.sendWs).toHaveBeenCalledTimes(1);
    });

    it('a cancel waits for the same outgoing ring', () => {
      const harness = setup();
      harness.sendWs.mockReturnValue(false);
      const outgoing: DmCallView = { ...incoming, phase: 'outgoing', callerId: 'me', peerId: 'peer' };
      act(() => harness.result.current.onDmCall(outgoing));
      act(() => harness.result.current.cancelDmCall());
      harness.sendWs.mockReturnValue(true);
      act(() => harness.result.current.onReconnected(outgoing));
      expect(harness.sendWs).toHaveBeenLastCalledWith({ t: 'dm-call-cancel', callId: 'k' });
    });

    it('an answer that left normally is not sent again on a later reconnect', () => {
      const { result, sendWs } = setup();
      act(() => result.current.onDmCall(incoming));
      act(() => result.current.acceptDmCall());
      act(() => result.current.onReconnected(incoming));
      expect(sendWs).toHaveBeenCalledTimes(1);
    });
  });
});
