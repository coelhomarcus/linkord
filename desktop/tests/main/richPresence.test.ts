import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DetectedActivity } from '../../src/main/activityDetect.js';
import {
  attachRichPresence, createFrameDecoder, encodeFrame, handleCommand, isDiscordProcess, MAX_FRAME_BYTES, OP,
  parseHandshake, sanitizeRichPresence, type RichSession,
} from '../../src/main/richPresence.js';

const APP = '383226320970055681';

describe('frame decoder', () => {
  it('reads frames split across chunks and joined in one', () => {
    const decoder = createFrameDecoder();
    const both = Buffer.concat([encodeFrame(OP.handshake, { v: 1, client_id: APP }), encodeFrame(OP.ping, { n: 1 })]);
    assert.deepEqual(decoder.push(both.subarray(0, 5)), { frames: [], invalid: false });
    assert.deepEqual(decoder.push(both.subarray(5, 30)), { frames: [], invalid: false });
    const rest = decoder.push(both.subarray(30));
    assert.equal(rest.invalid, false);
    assert.deepEqual(rest.frames, [{ op: OP.handshake, data: { v: 1, client_id: APP } }, { op: OP.ping, data: { n: 1 } }]);
  });

  it('refuses a frame larger than any presence before reading it', () => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(OP.frame, 0);
    header.writeUInt32LE(MAX_FRAME_BYTES + 1, 4);
    assert.equal(createFrameDecoder().push(header).invalid, true);
  });

  it('refuses a frame that is not JSON', () => {
    const body = Buffer.from('{nope');
    const header = Buffer.alloc(8);
    header.writeUInt32LE(OP.frame, 0);
    header.writeUInt32LE(body.length, 4);
    assert.equal(createFrameDecoder().push(Buffer.concat([header, body])).invalid, true);
  });
});

describe('parseHandshake', () => {
  it('takes version 1 with an application id', () => {
    assert.equal(parseHandshake({ v: 1, client_id: APP }), APP);
    assert.equal(parseHandshake({ v: '1', client_id: APP }), APP);
  });

  it('refuses another version or an id that is not a snowflake', () => {
    assert.equal(parseHandshake({ v: 2, client_id: APP }), null);
    assert.equal(parseHandshake({ v: 1, client_id: 'abc' }), null);
    assert.equal(parseHandshake({ v: 1, client_id: 123 }), null);
    assert.equal(parseHandshake(null), null);
  });
});

describe('sanitizeRichPresence', () => {
  it('keeps the shown fields, in seconds or ms', () => {
    assert.deepEqual(sanitizeRichPresence({
      details: 'Competitive', state: 'In a match',
      assets: { large_image: 'map_dust', large_text: 'Dust II', small_image: 'https://example.com/rank.png', small_text: 'Gold' },
      party: { id: 'x', size: [2, 5] },
      timestamps: { start: 1_700_000_000, end: 1_700_000_600_000 },
      buttons: [{ label: 'Join', url: 'https://example.com/join' }],
      secrets: { join: 'secret' },
    }), {
      details: 'Competitive',
      state: 'In a match',
      largeImage: { key: 'map_dust', text: 'Dust II' },
      smallImage: { key: 'https://example.com/rank.png', text: 'Gold' },
      party: { size: 2, max: 5 },
      timestamps: { start: 1_700_000_000_000, end: 1_700_000_600_000 },
      buttons: [{ label: 'Join', url: 'https://example.com/join' }],
    });
  });

  it('cuts and cleans what a hostile program sends', () => {
    const rich = sanitizeRichPresence({
      details: `a\u0000b\u202e${'x'.repeat(300)}`,
      state: '   ',
      assets: { large_image: 'javascript:alert(1)', small_image: 'http://example.com/a.png' },
      party: { size: [6, 5] },
      timestamps: { start: 2000, end: 1000 },
      buttons: [{ label: 'Free', url: 'http://example.com' }, { label: 'x', url: 'https://user:pw@example.com' }, { label: '', url: 'https://example.com' }],
    });
    assert.equal(rich?.details?.startsWith('a b x'), true);
    assert.equal(Array.from(rich!.details!).length, 128);
    assert.deepEqual(Object.keys(rich!), ['details', 'timestamps']);
    assert.deepEqual(rich!.timestamps, { start: 2_000_000 });
  });

  it('keeps only two buttons and nothing when nothing is valid', () => {
    const many = Array.from({ length: 4 }, (_, i) => ({ label: `b${i}`, url: `https://example.com/${i}` }));
    assert.equal(sanitizeRichPresence({ buttons: many })?.buttons?.length, 2);
    assert.equal(sanitizeRichPresence({ type: 0 }), undefined);
    assert.equal(sanitizeRichPresence('nope'), undefined);
  });

  it('accepts a media proxy key for an external picture', () => {
    assert.deepEqual(sanitizeRichPresence({ assets: { large_image: 'mp:external/abc/https/example.com/a.png' } }), {
      largeImage: { key: 'mp:external/abc/https/example.com/a.png' },
    });
  });
});

describe('handleCommand', () => {
  it('sets an activity with its pid and kind, and echoes it', () => {
    const activity = { type: 2, details: 'Song' };
    const result = handleCommand({ cmd: 'SET_ACTIVITY', args: { pid: 42, activity }, nonce: 'n1' });
    assert.deepEqual(result, {
      kind: 'set-activity',
      activity: { pid: 42, kind: 'using', rich: { details: 'Song' } },
      reply: { cmd: 'SET_ACTIVITY', evt: null, nonce: 'n1', data: activity },
    });
  });

  it('clears on a null activity', () => {
    const result = handleCommand({ cmd: 'SET_ACTIVITY', args: { pid: 42, activity: null }, nonce: 'n2' });
    assert.equal(result.kind, 'set-activity');
    assert.equal(result.kind === 'set-activity' && result.activity, null);
  });

  it('acknowledges subscriptions and refuses anything else', () => {
    assert.deepEqual(handleCommand({ cmd: 'SUBSCRIBE', evt: 'ACTIVITY_JOIN', nonce: 'a' }), {
      kind: 'reply', reply: { cmd: 'SUBSCRIBE', evt: null, nonce: 'a', data: { evt: 'ACTIVITY_JOIN' } },
    });
    const refused = handleCommand({ cmd: 'AUTHORIZE', nonce: 'b' });
    assert.equal(refused.kind, 'reply');
    assert.equal((refused.reply as { evt: string }).evt, 'ERROR');
  });
});

describe('isDiscordProcess', () => {
  it('knows every Discord build by its program', () => {
    assert.equal(isDiscordProcess('Discord.exe'), true);
    assert.equal(isDiscordProcess('C:\\Users\\a\\AppData\\Local\\DiscordCanary\\app-1.0\\DiscordCanary.exe'), true);
    assert.equal(isDiscordProcess('Spotify.exe'), false);
  });
});

describe('attachRichPresence', () => {
  const roblox: DetectedActivity = { key: 'roblox', kind: 'playing', name: 'Roblox', pid: 7, pids: [7, 8] };
  const steam: DetectedActivity = { key: 'steam:730', kind: 'playing', name: 'Counter-Strike 2', steamAppId: 730, pids: [] };
  const session = (over: Partial<RichSession>): RichSession => ({ clientId: APP, pid: 8, kind: 'playing', rich: { state: 'Lobby' }, updatedAt: 1, ...over });

  it('attaches a presence to the activity that owns its pid, keeping its key', () => {
    const [attached] = attachRichPresence({ candidates: [roblox], sessions: [session({})] });
    assert.deepEqual(attached, { ...roblox, discordAppId: APP, rich: { state: 'Lobby' } });
  });

  it('attaches it to the Steam game when the pid runs from its folder', () => {
    const result = attachRichPresence({
      candidates: [steam],
      sessions: [session({ pid: 99 })],
      steamInstallDir: 'C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive',
      exePaths: new Map([[99, 'C:\\Steam\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe']]),
    });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.discordAppId, APP);
  });

  it('makes an activity of its own for a game nothing else found', () => {
    const result = attachRichPresence({ candidates: [roblox], sessions: [session({ pid: 50, kind: 'using' })] });
    assert.deepEqual(result[1], { key: `discord:${APP}`, kind: 'using', name: '', discordAppId: APP, rich: { state: 'Lobby' }, pid: 50, pids: [50] });
    assert.deepEqual(result[0], roblox);
  });

  it('lets the newest presence win when two report for one game', () => {
    const result = attachRichPresence({
      candidates: [roblox],
      sessions: [session({ pid: 7, rich: { state: 'old' }, updatedAt: 1 }), session({ pid: 8, rich: { state: 'new' }, updatedAt: 2 })],
    });
    assert.deepEqual(result[0]!.rich, { state: 'new' });
  });
});
