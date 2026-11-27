import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchSocketEvent, routeSocketEvent, handlers, ACTION_LIMITS } from '../../src/realtime/socket.js';
import type { AppSocket } from '../../src/types.js';

// Names a plain object inherits from Object.prototype; a client can send any of them as an event.
const PROTOTYPE_NAMES = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'toLocaleString'];

afterEach(() => mock.restoreAll());

/** Captures every line the logger writes while `run` executes. */
function captureLogs(run: () => void): string[] {
  const lines: string[] = [];
  const capture = (chunk: unknown): boolean => { lines.push(String(chunk)); return true; };
  mock.method(process.stdout, 'write', capture);
  mock.method(process.stderr, 'write', capture);
  try { run(); } finally { mock.restoreAll(); }
  return lines;
}

function fakeSocket(): AppSocket {
  return { participantId: null, ip: '127.0.0.1', user: { userId: 'u1' } } as unknown as AppSocket;
}

describe('socket event dispatch', () => {
  test('prototype names are not routed to a handler or a rate limit', () => {
    for (const name of PROTOTYPE_NAMES) {
      assert.equal(routeSocketEvent(name), undefined, name);
    }
  });

  test('a known event finds its own handler and limit', () => {
    const route = routeSocketEvent('chat');
    assert.equal(route?.handler, handlers.chat);
    assert.equal(route?.rule, ACTION_LIMITS.chat);
  });

  test('an event without a limit is routed without one', () => {
    assert.equal(routeSocketEvent('speaking')?.rule, undefined);
  });

  test('prototype names are ignored without logging, like other unknown events', () => {
    const socket = fakeSocket();
    const lines = captureLogs(() => {
      for (const name of [...PROTOTYPE_NAMES, 'no-such-event']) {
        dispatchSocketEvent(socket, name, { conversationId: 'c1' });
      }
    });
    assert.deepEqual(lines, []);
  });
});
