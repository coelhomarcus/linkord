import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { AppSocket, Participant } from '../../../src/types.js';
import { participants, join } from '../../../src/modules/presence/participants.js';
import { handlers, PLAYGROUND_TOKEN_TTL_MS, setPlaygroundAccessForTests } from '../../../src/modules/playground/playgroundAccess.js';
import { parsePlaygroundUrl } from '../../../src/config/env.js';

const SECRET = 's'.repeat(32);
const URL = 'https://chat.example.com';

describe('playground-token', () => {
  const sent: { t: string; [key: string]: unknown }[] = [];
  let created: Participant[] = [];

  function connect(callConversationId: string | null): { socket: AppSocket; p: Participant } {
    const userId = `user-${Math.random()}`;
    const socket = {
      participantId: null, ip: '127.0.0.1', connected: true, disconnect: () => {},
      emit: (t: string, msg: { t: string }) => { sent.push({ ...msg, t }); },
      user: { tokenHash: 'x', userId, username: userId, displayName: '', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' },
    } as unknown as AppSocket;
    const p = join(socket, {})!.participant;
    p.callConversationId = callConversationId;
    created.push(p);
    return { socket, p };
  }

  const ask = (socket: AppSocket, conversationId: string) => handlers['playground-token']!(socket, { conversationId });
  const claimsOf = (token: string) => {
    const [body, mac] = token.split('.');
    assert.equal(mac, crypto.createHmac('sha256', SECRET).update(body!).digest('base64url'));
    return JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<string, unknown>;
  };

  beforeEach(() => {
    setPlaygroundAccessForTests({ url: URL, secret: SECRET }, async (conversationId) => conversationId.startsWith('playground'));
  });

  afterEach(() => {
    for (const p of created) {
      if (p.graceTimer) clearTimeout(p.graceTimer);
      participants.delete(p.id);
    }
    created = [];
    sent.length = 0;
  });

  test('a connection in a playground call gets a signed pass for it', async () => {
    const { socket, p } = connect('playground-1');
    const before = Date.now();
    await ask(socket, 'playground-1');
    const [answer] = sent;
    assert.equal(answer!.t, 'playground-token');
    assert.equal(answer!.url, URL);
    const claims = claimsOf(answer!.token as string);
    assert.deepEqual({ ...claims, exp: undefined }, { pid: p.id, uid: p.userId, cid: 'playground-1', exp: undefined });
    assert.ok((claims.exp as number) >= before + PLAYGROUND_TOKEN_TTL_MS);
  });

  test('nothing for another call, a voice channel or a service that is off', async () => {
    const elsewhere = connect('playground-2');
    await ask(elsewhere.socket, 'playground-1');
    const voice = connect('voice-1');
    await ask(voice.socket, 'voice-1');
    setPlaygroundAccessForTests({ url: '', secret: '' }, async () => true);
    const off = connect('playground-1');
    await ask(off.socket, 'playground-1');
    assert.deepEqual(sent, [
      { t: 'playground-token', conversationId: 'playground-1', token: null },
      { t: 'playground-token', conversationId: 'voice-1', token: null },
      { t: 'playground-token', conversationId: 'playground-1', token: null },
    ]);
  });
});

describe('parsePlaygroundUrl', () => {
  test('empty leaves the service off', () => {
    assert.equal(parsePlaygroundUrl(undefined), '');
    assert.equal(parsePlaygroundUrl('  '), '');
  });

  test('keeps the origin of an http(s) address', () => {
    assert.equal(parsePlaygroundUrl('https://chat.example.com/'), 'https://chat.example.com');
    assert.equal(parsePlaygroundUrl(' http://localhost:3100 '), 'http://localhost:3100');
  });

  test('refuses a path, another scheme or garbage, naming the variable', () => {
    for (const bad of ['https://chat.example.com/playground', 'ws://localhost:3100', 'chat.example.com']) {
      assert.throws(() => parsePlaygroundUrl(bad), /PLAYGROUND_URL/, bad);
    }
  });
});
