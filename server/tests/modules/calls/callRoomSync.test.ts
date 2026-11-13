import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AppSocket, Participant } from '../../../src/types.js';
import { config } from '../../../src/config/env.js';
import { join, participants, removeParticipant, setCallConversationId, setCallLeftHook } from '../../../src/modules/presence/participants.js';
import { conversationIdOfRoom, roomNameFor } from '../../../src/integrations/livekit/livekit.js';
import { closeCallMedia, resetCallRoomSync, sweepCallRooms } from '../../../src/modules/calls/callRoomSync.js';

function connect(userId: string): Participant {
  const socket = {
    participantId: null,
    ip: '127.0.0.1',
    connected: true,
    emit: () => {},
    disconnect: () => {},
    user: { tokenHash: 'x', userId, username: userId, displayName: '', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' },
  } as unknown as AppSocket;
  const joined = join(socket, {});
  assert.ok(joined);
  return joined.participant;
}

function fakeSfu(rooms: Record<string, string[]>) {
  const removed: string[] = [];
  return {
    removed,
    api: {
      listRooms: async () => Object.keys(rooms).map((name) => ({ name })),
      listParticipants: async (room: string) => (rooms[room] ?? []).map((identity) => ({ identity })),
      removeParticipant: async (room: string, identity: string) => {
        removed.push(`${room}/${identity}`);
        rooms[room] = (rooms[room] ?? []).filter((i) => i !== identity);
      },
    },
  };
}

const original = { url: config.LIVEKIT_URL, key: config.LIVEKIT_API_KEY };
before(() => { config.LIVEKIT_URL = 'wss://sfu.test'; config.LIVEKIT_API_KEY = 'key'; });
after(() => { config.LIVEKIT_URL = original.url; config.LIVEKIT_API_KEY = original.key; });
afterEach(() => {
  setCallLeftHook(null);
  resetCallRoomSync();
  for (const p of [...participants.values()]) removeParticipant(p);
});

describe('conversationIdOfRoom', () => {
  it("reads this deployment's rooms only", () => {
    const id = crypto.randomUUID();
    assert.equal(conversationIdOfRoom(roomNameFor(id)), id);
    assert.equal(conversationIdOfRoom(`${config.LIVEKIT_ROOM_NAME}-staging-${id}`), null);
    assert.equal(conversationIdOfRoom(`another-app-${id}`), null);
  });
});

describe('call-left hook', () => {
  it('fires when a connection leaves, moves to another call, or is removed while in one', () => {
    const left: string[] = [];
    setCallLeftHook((p, conversationId) => { left.push(`${p.id}:${conversationId}`); });
    const p = connect('user-a');
    setCallConversationId(p, 'c1');
    setCallConversationId(p, 'c1');
    assert.deepEqual(left, []);
    setCallConversationId(p, 'c2');
    setCallConversationId(p, null);
    setCallConversationId(p, 'c3');
    removeParticipant(p);
    assert.deepEqual(left, [`${p.id}:c1`, `${p.id}:c2`, `${p.id}:c3`]);
  });
});

describe('closeCallMedia', () => {
  it('removes the identity from the room it left', async () => {
    const conversationId = crypto.randomUUID();
    const { api, removed } = fakeSfu({ [roomNameFor(conversationId)]: ['tab-1'] });
    assert.equal(await closeCallMedia('tab-1', conversationId, api), true);
    assert.deepEqual(removed, [`${roomNameFor(conversationId)}/tab-1`]);
  });

  it('leaves alone a connection that already rejoined the same call', async () => {
    const conversationId = crypto.randomUUID();
    const p = connect('user-a');
    setCallConversationId(p, conversationId);
    const { api, removed } = fakeSfu({ [roomNameFor(conversationId)]: [p.id] });
    assert.equal(await closeCallMedia(p.id, conversationId, api), false);
    assert.deepEqual(removed, []);
  });
});

describe('sweepCallRooms', () => {
  it('keeps the members the server has in that call', async () => {
    const conversationId = crypto.randomUUID();
    const p = connect('user-a');
    setCallConversationId(p, conversationId);
    const { api, removed } = fakeSfu({ [roomNameFor(conversationId)]: [p.id] });
    await sweepCallRooms(api);
    await sweepCallRooms(api);
    assert.deepEqual(removed, []);
  });

  it('removes a stranger on its second sighting', async () => {
    const conversationId = crypto.randomUUID();
    const room = roomNameFor(conversationId);
    const { api, removed } = fakeSfu({ [room]: ['stray'] });
    await sweepCallRooms(api);
    assert.deepEqual(removed, []);
    await sweepCallRooms(api);
    assert.deepEqual(removed, [`${room}/stray`]);
  });

  it('removes on sight an identity the server already removed (a kept token used again)', async () => {
    const conversationId = crypto.randomUUID();
    const room = roomNameFor(conversationId);
    const p = connect('user-a');
    setCallConversationId(p, conversationId);
    setCallConversationId(p, null);
    const rooms = { [room]: [p.id] };
    const { api, removed } = fakeSfu(rooms);
    await closeCallMedia(p.id, conversationId, api);
    rooms[room] = [p.id];
    await sweepCallRooms(api);
    assert.deepEqual(removed, [`${room}/${p.id}`, `${room}/${p.id}`]);
  });

  it('removes a connection still in the room of a call it moved away from', async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const p = connect('user-a');
    setCallConversationId(p, second);
    const { api, removed } = fakeSfu({ [roomNameFor(first)]: [p.id], [roomNameFor(second)]: [p.id] });
    await sweepCallRooms(api);
    await sweepCallRooms(api);
    assert.deepEqual(removed, [`${roomNameFor(first)}/${p.id}`]);
  });

  it("never touches rooms that are not this deployment's", async () => {
    const { api, removed } = fakeSfu({ [`${config.LIVEKIT_ROOM_NAME}-staging-${crypto.randomUUID()}`]: ['x'], 'other-room': ['y'] });
    await sweepCallRooms(api);
    await sweepCallRooms(api);
    assert.deepEqual(removed, []);
  });
});
