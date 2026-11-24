import { describe, expect, it } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import type { Participant } from '@/shared/types/protocol';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { screenPresenterId } from '@/features/playground/screenPresenter';

const person = (id: string, sharing: boolean, callConversationId = 'pg') => ({ id, userId: `u-${id}`, sharing, callConversationId }) as Participant;

function room(participants: Participant[], meSharing = false) {
  return createFakeRoomContextValue({
    state: {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'm', sharing: meSharing },
      // the server's echo of you may lag behind your own flag
      participants: new Map([...participants, person('m', false)].map((p) => [p.id, p])),
    },
  });
}

describe('screenPresenterId', () => {
  it('is nobody while nobody in the call shares', () => {
    expect(screenPresenterId(room([person('b', false), person('c', true, 'elsewhere')]), 'pg')).toBeNull();
  });

  it('picks the lowest id when two people share at once, so both sides agree', () => {
    expect(screenPresenterId(room([person('c', true), person('b', true)]), 'pg')).toBe('b');
  });

  it('counts your own share from the moment you start it', () => {
    expect(screenPresenterId(room([], true), 'pg')).toBe('m');
    expect(screenPresenterId(room([person('a', true)], true), 'pg')).toBe('a');
  });
});
