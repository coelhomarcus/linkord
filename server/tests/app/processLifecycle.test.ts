import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it, mock } from 'node:test';
import { installProcessLifecycle, type ShutdownSteps } from '../../src/app/processLifecycle.js';

function setup(closeHttp: () => Promise<void> = () => Promise.resolve()) {
  const proc = Object.assign(new EventEmitter(), { exit: mock.fn((_code: number) => {}) });
  const errors: string[] = [];
  const log = { info: () => {}, error: (msg: string) => { errors.push(msg); } };
  const lifecycle = installProcessLifecycle(proc, log, 3000);
  const steps = { stop: mock.fn(() => {}), closeHttp: mock.fn(closeHttp) } satisfies ShutdownSteps;
  const exitCodes = () => proc.exit.mock.calls.map((c) => c.arguments[0]);
  return { proc, lifecycle, steps, errors, exitCodes };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('process lifecycle', () => {
  for (const kind of ['uncaughtException', 'unhandledRejection'] as const) {
    it(`a ${kind} runs the deploy shutdown and exits non-zero`, async () => {
      const { proc, lifecycle, steps, errors, exitCodes } = setup();
      lifecycle.ready(steps);
      proc.emit(kind, new Error('boom'));
      await flush();
      assert.equal(steps.stop.mock.callCount(), 1);
      assert.equal(steps.closeHttp.mock.callCount(), 1);
      assert.deepEqual(exitCodes(), [1]);
      assert.match(errors[0], new RegExp(`fatal ${kind}`));
    });
  }

  it('SIGTERM shuts down the same way and exits 0', async () => {
    const { proc, lifecycle, steps, exitCodes } = setup();
    lifecycle.ready(steps);
    proc.emit('SIGTERM');
    await flush();
    assert.equal(steps.stop.mock.callCount(), 1);
    assert.deepEqual(exitCodes(), [0]);
  });

  it('runs the shutdown once, and a crash during a deploy still exits non-zero', async () => {
    let finishClose!: () => void;
    const { proc, lifecycle, steps, exitCodes } = setup(() => new Promise<void>((resolve) => { finishClose = resolve; }));
    lifecycle.ready(steps);
    proc.emit('SIGTERM');
    proc.emit('uncaughtException', new Error('during close'));
    finishClose();
    await flush();
    assert.equal(steps.stop.mock.callCount(), 1);
    assert.deepEqual(exitCodes(), [1]);
  });

  it('still closes HTTP and exits when a shutdown step throws', async () => {
    const { proc, lifecycle, steps, errors, exitCodes } = setup();
    steps.stop.mock.mockImplementation(() => { throw new Error('broken state'); });
    lifecycle.ready(steps);
    proc.emit('uncaughtException', new Error('boom'));
    await flush();
    assert.equal(steps.closeHttp.mock.callCount(), 1);
    assert.deepEqual(exitCodes(), [1]);
    assert.ok(errors.includes('shutdown step failed'));
  });

  it('exits non-zero when closing HTTP fails', async () => {
    const { proc, lifecycle, steps, exitCodes } = setup(() => Promise.reject(new Error('close failed')));
    lifecycle.ready(steps);
    proc.emit('SIGTERM');
    await flush();
    assert.deepEqual(exitCodes(), [1]);
  });

  it('leaves at the deadline when closing HTTP hangs', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { proc, lifecycle, steps, exitCodes } = setup(() => new Promise<void>(() => {}));
      lifecycle.ready(steps);
      proc.emit('uncaughtException', new Error('boom'));
      mock.timers.tick(2999);
      assert.deepEqual(exitCodes(), []);
      mock.timers.tick(1);
      assert.deepEqual(exitCodes(), [1]);
    } finally {
      mock.timers.reset();
    }
  });

  it('exits at once before the server is ready', () => {
    const { proc, exitCodes } = setup();
    proc.emit('uncaughtException', new Error('during boot'));
    assert.deepEqual(exitCodes(), [1]);
  });
});
