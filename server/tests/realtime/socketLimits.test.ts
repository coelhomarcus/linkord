import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_LIMITS, handlers } from '../../src/realtime/socket.js';

// Events that stay outside ACTION_LIMITS, each for a reason: media flags are coalesced in
// participants.ts, and `leave` ends the connection's participant.
const UNLIMITED = new Set(['deafened', 'mic-state', 'camera', 'screen-share', 'speaking', 'leave']);

describe('socket action limits', () => {
  test('every event in the handler table is limited or deliberately left out', () => {
    const missing = Object.keys(handlers).filter((event) => !ACTION_LIMITS[event] && !UNLIMITED.has(event));
    assert.deepEqual(missing, []);
  });

  test('no limit names an event nobody handles', () => {
    const unknown = Object.keys(ACTION_LIMITS).filter((event) => !handlers[event]);
    assert.deepEqual(unknown, []);
  });
});
