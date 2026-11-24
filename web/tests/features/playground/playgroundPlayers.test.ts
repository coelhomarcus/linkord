import { describe, expect, it } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import type { Participant } from '@/shared/types/protocol';
import type { RoomContextValue } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { playgroundPlayers, samePlayers } from '@/features/playground/playgroundPlayers';

const person = (id: string, fields: Partial<Participant> = {}) => ({
  id, userId: `u-${id}`, name: id, displayName: '', callConversationId: 'pg',
  micActivated: true, micMuted: false, deafened: false, speaking: false, sharing: false, cameraOn: false,
  ...fields,
}) as Participant;

function room(participants: Participant[], extra: Partial<RoomContextValue> = {}, meFields: Partial<typeof initialRoomState.me> = {}) {
  return createFakeRoomContextValue({
    ...extra,
    state: {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'm', userId: 'u-m', name: 'me', ...meFields },
      participants: new Map(participants.map((p) => [p.id, p])),
    },
  });
}

const ids = ['a', 'b', 'm'];

describe('playgroundPlayers', () => {
  it('reads muted, deafened and who is on the big screen', () => {
    const players = playgroundPlayers(room([
      person('a', { micMuted: true, speaking: true }),
      person('b', { deafened: true, micMuted: true, sharing: true }),
      person('m'),
    ]), ids, 'pg', false);
    expect(players.map(({ id, speaking, micMuted, deafened, presenting }) => ({ id, speaking, micMuted, deafened, presenting }))).toEqual([
      { id: 'a', speaking: false, micMuted: true, deafened: false, presenting: false },
      { id: 'b', speaking: false, micMuted: true, deafened: true, presenting: true },
      { id: 'm', speaking: false, micMuted: false, deafened: false, presenting: false },
    ]);
  });

  it('counts a mic that never started as muted', () => {
    expect(playgroundPlayers(room([person('a', { micActivated: false })]), ['a'], 'pg', false)[0]!.micMuted).toBe(true);
  });

  it('takes your own deafen and share from the moment you press them', () => {
    const [me] = playgroundPlayers(room([person('m')], { deafened: true }, { sharing: true }), ['m'], 'pg', false);
    expect(me).toMatchObject({ deafened: true, presenting: true });
  });

  it('takes your own mic from this tab rather than the server echo', () => {
    expect(playgroundPlayers(room([person('m', { micStarting: true, micActivated: false })]), ['m'], 'pg', true)[0]!.micMuted).toBe(true);
  });

  it('shows you before the server echoes you', () => {
    expect(playgroundPlayers(room([]), ['m'], 'pg', true)).toEqual([
      { id: 'm', userId: 'u-m', name: 'me', speaking: false, micMuted: true, deafened: false, presenting: false },
    ]);
  });

  it('has nobody on the big screen outside a call', () => {
    expect(playgroundPlayers(room([person('a', { sharing: true })]), ['a'], null, false)[0]!.presenting).toBe(false);
  });
});

describe('samePlayers', () => {
  const base = () => playgroundPlayers(room([person('a'), person('b')]), ['a', 'b'], 'pg', false);

  it('holds while nothing a nameplate shows changes', () => {
    const again = playgroundPlayers(room([person('a', { cameraOn: true }), person('b')]), ['a', 'b'], 'pg', false);
    expect(samePlayers(base(), again)).toBe(true);
  });

  it.each([
    ['speaking', { speaking: true }],
    ['muting', { micMuted: true }],
    ['deafening', { deafened: true }],
    ['sharing the big screen', { sharing: true }],
    ['a new name', { displayName: 'Ana' }],
  ] as const)('changes on %s', (_, fields) => {
    const changed = playgroundPlayers(room([person('a', fields), person('b')]), ['a', 'b'], 'pg', false);
    expect(samePlayers(base(), changed)).toBe(false);
  });

  it('changes when someone joins or leaves', () => {
    expect(samePlayers(base(), base().slice(1))).toBe(false);
  });
});
