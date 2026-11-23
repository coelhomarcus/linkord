import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createFrameDecoder, encodeFrame, OP, type Frame } from '../../src/main/richPresence.js';
import { createRichPresenceServer } from '../../src/main/richPresenceServer.js';

// The pipe is a Unix socket in a folder of its own here; on Windows the same code listens on a named pipe.
const APP = '383226320970055681';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rpc-'));
let folders = 0;
after(() => fs.rmSync(root, { recursive: true, force: true }));

function pipes() {
  const dir = path.join(root, String(folders++));
  fs.mkdirSync(dir);
  return (index: number) => path.join(dir, `ipc-${index}`);
}

/** A game on the pipe: sends frames and collects what comes back. */
async function game(pipe: string) {
  const socket = net.connect(pipe);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const decoder = createFrameDecoder();
  const received: Frame[] = [];
  const waiters: (() => void)[] = [];
  socket.on('data', (chunk: Buffer) => {
    received.push(...decoder.push(chunk).frames);
    waiters.splice(0).forEach((wake) => wake());
  });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  return {
    send: (op: number, data: unknown) => socket.write(encodeFrame(op, data)),
    async next(): Promise<Frame> {
      while (received.length === 0) await new Promise<void>((resolve) => waiters.push(resolve));
      return received.shift()!;
    },
    close: () => socket.destroy(),
    closed,
  };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(check(), true);
};

describe('rich presence server', () => {
  it('answers the handshake and keeps what a game sets until it leaves', async () => {
    const pipePath = pipes();
    const changes: boolean[] = [];
    const server = createRichPresenceServer({ pipePath, onChange: (structural) => changes.push(structural) });
    await server.ensure();
    assert.equal(server.listening(), true);

    const client = await game(pipePath(0));
    client.send(OP.handshake, { v: 1, client_id: APP });
    const ready = await client.next();
    assert.equal((ready.data as { evt: string }).evt, 'READY');

    client.send(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: 123, activity: { details: 'Ranked' } }, nonce: '1' });
    assert.equal(((await client.next()).data as { nonce: string }).nonce, '1');
    assert.deepEqual(server.sessions().map(({ updatedAt: _, ...s }) => s), [{ clientId: APP, pid: 123, kind: 'playing', rich: { details: 'Ranked' } }]);
    assert.deepEqual(changes, [true]);

    client.send(OP.ping, { x: 1 });
    assert.deepEqual(await client.next(), { op: OP.pong, data: { x: 1 } });

    client.close();
    await until(() => server.sessions().length === 0);
    assert.deepEqual(changes, [true, true]);
    server.close();
  });

  it('closes a connection whose handshake is not a game', async () => {
    const pipePath = pipes();
    const server = createRichPresenceServer({ pipePath, onChange: () => {} });
    await server.ensure();
    const client = await game(pipePath(0));
    client.send(OP.handshake, { v: 1, client_id: 'nope' });
    assert.equal((await client.next()).op, OP.close);
    await client.closed;
    server.close();
  });

  it('passes a change of text at most once per throttle, the last one winning', async () => {
    const pipePath = pipes();
    const changes: boolean[] = [];
    const server = createRichPresenceServer({ pipePath, onChange: (structural) => changes.push(structural), throttleMs: 60 });
    await server.ensure();
    const client = await game(pipePath(0));
    client.send(OP.handshake, { v: 1, client_id: APP });
    await client.next();
    for (const state of ['a', 'b', 'c']) {
      client.send(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: 1, activity: { state } }, nonce: state });
      await client.next();
    }
    assert.deepEqual(changes, [true]);
    await until(() => changes.length === 2);
    assert.deepEqual(changes, [true, false]);
    assert.deepEqual(server.sessions()[0]!.rich, { state: 'c' });
    client.close();
    server.close();
  });

  it('does not listen while another program holds a Discord pipe, and lets go when one appears', async () => {
    const pipePath = pipes();
    const discord = net.createServer(() => {});
    await new Promise<void>((resolve) => discord.listen(pipePath(0), resolve));
    const server = createRichPresenceServer({ pipePath, onChange: () => {} });
    await server.ensure();
    assert.equal(server.listening(), false);
    await new Promise<void>((resolve) => discord.close(() => resolve()));

    await server.ensure();
    assert.equal(server.listening(), true);
    const client = await game(pipePath(0));
    const late = net.createServer(() => {});
    await new Promise<void>((resolve) => late.listen(pipePath(1), resolve));
    await server.ensure();
    assert.equal(server.listening(), false);
    await client.closed;
    await new Promise<void>((resolve) => late.close(() => resolve()));
    server.close();
  });
});
