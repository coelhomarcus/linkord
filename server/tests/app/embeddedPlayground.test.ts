import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { restartDelay, startEmbeddedPlayground } from '../../src/app/embeddedPlayground.js';

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  readonly pid = 1;
  killed: string[] = [];
  kill(signal: string): boolean {
    this.killed.push(signal);
    this.exitCode = 0;
    this.emit('exit', 0, signal);
    return true;
  }
}

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

describe('embedded playground', () => {
  test('the delays before a restart grow, and stop growing', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 9].map(restartDelay), [1000, 2000, 5000, 10_000, 30_000, 30_000]);
  });

  test('runs the service on its own port with this process\'s environment, and starts it again after a crash', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const children: FakeChild[] = [];
    const envs: NodeJS.ProcessEnv[] = [];
    let clock = 0;
    const embedded = startEmbeddedPlayground({
      port: 3100, log: quiet, entry: 'playground.js', now: () => clock,
      spawn: (_entry, env) => { envs.push(env); const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess; },
    });
    assert.equal(children.length, 1);
    assert.equal(envs[0]!.PLAYGROUND_PORT, '3100');
    children[0]!.exitCode = 1;
    children[0]!.emit('exit', 1, null);
    t.mock.timers.tick(999);
    assert.equal(children.length, 1);
    t.mock.timers.tick(1);
    assert.equal(children.length, 2, 'started again after a second');
    // a second crash right away waits longer
    children[1]!.exitCode = 1;
    children[1]!.emit('exit', 1, null);
    t.mock.timers.tick(1999);
    assert.equal(children.length, 2);
    t.mock.timers.tick(1);
    assert.equal(children.length, 3);
    // after a long healthy run, the next crash waits a second again
    clock += 120_000;
    children[2]!.exitCode = 1;
    children[2]!.emit('exit', 1, null);
    t.mock.timers.tick(1000);
    assert.equal(children.length, 4);
    await embedded.stop();
    assert.deepEqual(children[3]!.killed, ['SIGTERM']);
  });

  test('a stop does not start it again', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const children: FakeChild[] = [];
    const embedded = startEmbeddedPlayground({
      port: 3100, log: quiet, entry: 'playground.js',
      spawn: () => { const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess; },
    });
    await embedded.stop();
    t.mock.timers.tick(60_000);
    assert.equal(children.length, 1);
  });
});
