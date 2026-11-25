import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { it } from 'node:test';

it('loads optional local values literally and keeps inherited values', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'linkord-env-test-'));
  const preload = path.resolve(import.meta.dirname, '../../src/config/loadLocalEnv.ts');
  const args = ['--no-env-file', '--preload', preload, '-p', 'JSON.stringify([process.env.LINKORD_ENV_TEST_VALUE, process.env.LINKORD_ENV_TEST_INHERITED])'];
  const env = { LINKORD_ENV_TEST_INHERITED: 'from-process' };
  try {
    const missing = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
    assert.equal(missing.status, 0, missing.stderr);
    assert.deepEqual(JSON.parse(missing.stdout), [null, 'from-process']);

    writeFileSync(path.join(cwd, '.env'), "LINKORD_ENV_TEST_VALUE='literal-$LINKORD_ENV_TEST_INHERITED'\nLINKORD_ENV_TEST_INHERITED=from-file\n");
    const loaded = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' });
    assert.equal(loaded.status, 0, loaded.stderr);
    assert.deepEqual(JSON.parse(loaded.stdout), ['literal-$LINKORD_ENV_TEST_INHERITED', 'from-process']);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
