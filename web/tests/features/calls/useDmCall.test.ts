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
});
