import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import { createToken, updatePublishRights } from '../../../src/integrations/livekit/livekit.js';
import { publishRightsFor } from '../../../src/modules/calls/callPermissions.js';
import { PERMISSIONS } from '../../../src/modules/servers/permissions.js';
import type { Participant } from '../../../src/types.js';

const original = { url: config.LIVEKIT_URL, key: config.LIVEKIT_API_KEY, secret: config.LIVEKIT_API_SECRET };
before(() => { config.LIVEKIT_URL = 'wss://sfu.test'; config.LIVEKIT_API_KEY = 'key'; config.LIVEKIT_API_SECRET = 'a-secret-long-enough-for-hs256-signing'; });
after(() => { config.LIVEKIT_URL = original.url; config.LIVEKIT_API_KEY = original.key; config.LIVEKIT_API_SECRET = original.secret; });

const participant = { id: 'p-1', name: 'ana', userId: 'u-1' } as Participant;

const decodeJwt = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;

async function videoGrant(rights?: { microphone: boolean; video: boolean; data: boolean }) {
  return decodeJwt(await createToken(participant, 'room-1', rights)).video as { canPublish?: boolean; canPublishSources?: string[]; canSubscribe?: boolean; canPublishData?: boolean };
}

describe('publishRightsFor', () => {
  it('reads SPEAK as the microphone and STREAM as camera and screen', () => {
    assert.deepEqual(publishRightsFor(PERMISSIONS.CONNECT | PERMISSIONS.SPEAK), { microphone: true, video: false, data: false });
    assert.deepEqual(publishRightsFor(PERMISSIONS.CONNECT | PERMISSIONS.STREAM), { microphone: false, video: true, data: false });
    assert.deepEqual(publishRightsFor(0), { microphone: false, video: false, data: false });
  });

  it('opens the data channel only in a playground, whatever else is allowed', () => {
    assert.deepEqual(publishRightsFor(PERMISSIONS.CONNECT, 'playground'), { microphone: false, video: false, data: true });
    assert.equal(publishRightsFor(PERMISSIONS.CONNECT | PERMISSIONS.SPEAK, 'standard').data, false);
  });
});

describe('createToken', () => {
  it('lets a DM call (no rights given) publish every source', async () => {
    const grant = await videoGrant();
    assert.equal(grant.canPublish, true);
    assert.deepEqual(grant.canPublishSources?.sort(), ['camera', 'microphone', 'screen_share', 'screen_share_audio']);
    assert.equal(grant.canPublishData, false);
  });

  it('lets a playground token publish data', async () => {
    assert.equal((await videoGrant({ microphone: true, video: true, data: true })).canPublishData, true);
  });

  it('limits the sources to what the channel allows', async () => {
    assert.deepEqual((await videoGrant({ microphone: true, video: false, data: false })).canPublishSources, ['microphone']);
    assert.deepEqual((await videoGrant({ microphone: false, video: true, data: false })).canPublishSources, ['camera', 'screen_share', 'screen_share_audio']);
  });

  it('turns publishing off instead of sending an empty list, which LiveKit reads as everything', async () => {
    const grant = await videoGrant({ microphone: false, video: false, data: false });
    assert.equal(grant.canPublish, false);
    assert.equal(grant.canSubscribe, true);
  });
});

describe('updatePublishRights', () => {
  it('sends the whole permission, keeping subscribe on', async () => {
    const calls: unknown[][] = [];
    const api = { updateParticipant: async (...args: unknown[]) => { calls.push(args); return {} as never; } };
    await updatePublishRights('room-1', 'p-1', { microphone: false, video: true, data: false }, api as never);
    assert.equal(calls.length, 1);
    const [room, identity, metadata, permission] = calls[0] as [string, string, unknown, Record<string, unknown>];
    assert.deepEqual([room, identity, metadata], ['room-1', 'p-1', undefined]);
    assert.equal(permission.canPublish, true);
    assert.equal(permission.canSubscribe, true);
    assert.equal(permission.canPublishData, false);
    assert.equal((permission.canPublishSources as unknown[]).length, 3);
  });

  it('does nothing on an instance without LiveKit', async () => {
    config.LIVEKIT_URL = '';
    try {
      let called = false;
      await updatePublishRights('room-1', 'p-1', { microphone: true, video: true, data: false }, { updateParticipant: async () => { called = true; return {} as never; } } as never);
      assert.equal(called, false);
    } finally {
      config.LIVEKIT_URL = 'wss://sfu.test';
    }
  });
});
