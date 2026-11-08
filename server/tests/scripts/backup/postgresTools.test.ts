import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it } from 'node:test';
import { BackupError } from '../../../src/scripts/backup/backupLayout.js';
import { pgConnection, runTool, sha256OfFile, withConnection, writeHashed } from '../../../src/scripts/backup/postgresTools.js';

const node = process.execPath;

describe('pgConnection', () => {
  it('moves the URL into PG* variables, so the password never reaches the command line', () => {
    const c = pgConnection('postgres://app%40corp:p%2Fss%3Aw%40rd@db.internal:6543/linkord?sslmode=require');
    assert.deepEqual(c.env, { PGHOST: 'db.internal', PGPORT: '6543', PGDATABASE: 'linkord', PGUSER: 'app@corp', PGPASSWORD: 'p/ss:w@rd' });
    assert.equal(c.database, 'linkord');
  });

  it('defaults the port and unwraps an IPv6 host', () => {
    const c = pgConnection('postgresql://u@[::1]/db');
    assert.equal(c.env.PGHOST, '::1');
    assert.equal(c.port, '5432');
    assert.equal(c.env.PGPASSWORD, undefined);
  });

  it('turns TLS verification on, against the pinned CA when there is one', () => {
    assert.equal(pgConnection('postgres://u@h/db').env.PGSSLMODE, undefined);
    assert.equal(pgConnection('postgres://u@h/db', { enabled: true }).env.PGSSLMODE, 'verify-full');
    assert.equal(pgConnection('postgres://u@h/db', { enabled: true }, '/tmp/ca.pem').env.PGSSLROOTCERT, '/tmp/ca.pem');
  });

  it('rejects what is not a Postgres URL', () => {
    assert.throws(() => pgConnection('not a url'), BackupError);
    assert.throws(() => pgConnection('mysql://u@h/db'), /postgres:\/\//);
    assert.throws(() => pgConnection('postgres://u@h/'), /does not name a database/);
  });

  it('writes a pinned CA to a private file for the tools and removes it afterwards', async () => {
    let caFile = '';
    await withConnection('postgres://u@h/db', { enabled: true, ca: 'PEM DATA' }, async (c) => {
      caFile = c.env.PGSSLROOTCERT!;
      assert.equal(await fs.readFile(caFile, 'utf8'), 'PEM DATA');
      assert.equal((await fs.stat(caFile)).mode & 0o077, 0);
    });
    await assert.rejects(fs.stat(caFile));
  });
});

describe('runTool', () => {
  it('collects stdout and passes the environment', async () => {
    const r = await runTool({ bin: node, args: ['-e', 'process.stdout.write(process.env.WHO)'], env: { WHO: 'linkord' }, what: 'echo' });
    assert.equal(r.stdout, 'linkord');
  });

  it('fails with the tool name, exit code and stderr', async () => {
    await assert.rejects(
      runTool({ bin: node, args: ['-e', 'console.error("boom"); process.exit(3)'], what: 'pg_dump' }),
      (err: Error) => err instanceof BackupError && /pg_dump failed \(exit 3\)/.test(err.message) && /boom/.test(err.message),
    );
  });

  it('can accept extra exit codes', async () => {
    const r = await runTool({ bin: node, args: ['-e', 'process.exit(1)'], okCodes: [0, 1], what: 'tar' });
    assert.equal(r.code, 1);
  });

  it('explains how to point at the tool when it is not installed', async () => {
    await assert.rejects(runTool({ bin: '/nonexistent/pg_dump', args: [], what: 'pg_dump' }), /PG_DUMP_BIN/);
  });

  it('pipes input to stdin and stdout to a sink', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkord-tool-test-'));
    try {
      const file = path.join(dir, 'out.bin');
      const digest = await writeHashed(
        (sink) => runTool({ bin: node, args: ['-e', 'process.stdin.pipe(process.stdout)'], input: Readable.from(['hello ', 'world']), output: sink, what: 'cat' }),
        file,
      );
      assert.equal(await fs.readFile(file, 'utf8'), 'hello world');
      assert.equal(digest.bytes, 11);
      assert.equal(digest.sha256, await sha256OfFile(file));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not report a broken pipe when the tool stops reading early', async () => {
    const big = Readable.from((function* () { for (let i = 0; i < 2000; i++) yield Buffer.alloc(64 * 1024, 1); })());
    await assert.rejects(runTool({ bin: node, args: ['-e', 'process.exit(2)'], input: big, what: 'pg_restore' }), /pg_restore failed \(exit 2\)/);
  });
});
