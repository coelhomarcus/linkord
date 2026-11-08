import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BackupError, BACKUP_FORMAT, DUMP_FILE, MANIFEST_FILE, type BackupManifest } from '../../../src/scripts/backup/backupLayout.js';
import { createBackup } from '../../../src/scripts/backup/createBackup.js';
import { ConfirmationRequired, readBackup, restoreBackup } from '../../../src/scripts/backup/restoreBackup.js';

// Nothing here reaches a database: every case is refused before the first
// connection, which is the point of the guards.
const UNREACHABLE = 'postgres://nobody:secret@127.0.0.1:1/linkord';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkord-restore-test-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

async function fakeBackup(dumpBytes = 'PGDMP fake'): Promise<string> {
  const folder = path.join(dir, 'linkord-backup-20261108T015300Z');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, DUMP_FILE), dumpBytes);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, createdAt: '2026-11-08T01:53:00.000Z', database: { name: 'linkord', serverVersion: '17', dumpTool: 'pg_dump' },
    migrations: 1, tables: { users: 1 }, uploads: { files: 0, bytes: 0, missingFromArchive: 0 },
    sha256: { dump: crypto.createHash('sha256').update(dumpBytes).digest('hex'), uploads: null },
  };
  await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify(manifest));
  return folder;
}

describe('readBackup', () => {
  it('accepts a backup whose files match the manifest', async () => {
    const { manifest, uploadsFile } = await readBackup(await fakeBackup());
    assert.equal(manifest.migrations, 1);
    assert.equal(uploadsFile, null);
  });

  it('refuses a dump that changed, or that is gone', async () => {
    const folder = await fakeBackup();
    await fs.writeFile(path.join(folder, DUMP_FILE), 'PGDMP tampered');
    await assert.rejects(readBackup(folder), /does not match the checksum/);
    await fs.rm(path.join(folder, DUMP_FILE));
    await assert.rejects(readBackup(folder), /missing or does not match/);
  });

  it('refuses an uploads archive the manifest promises but that is not there', async () => {
    const folder = await fakeBackup();
    const manifest = JSON.parse(await fs.readFile(path.join(folder, MANIFEST_FILE), 'utf8')) as BackupManifest;
    manifest.sha256.uploads = 'f'.repeat(64);
    await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify(manifest));
    await assert.rejects(readBackup(folder), /uploads\.tar\.gz is missing/);
  });

  it('refuses a folder with no manifest', async () => {
    await assert.rejects(readBackup(dir), /not a finished backup/);
  });
});

describe('restoreBackup guards', () => {
  const options = (backupPath: string, confirm: string | undefined, uploadDir = path.join(dir, 'uploads')) => ({ backupPath, databaseUrl: UNREACHABLE, uploadDir, confirm });

  it('does nothing without the database name typed back, and says which database it would use', async () => {
    const backupPath = await fakeBackup();
    await assert.rejects(restoreBackup(options(backupPath, undefined)), (err: unknown) => err instanceof ConfirmationRequired && err.database === 'linkord' && err.target === '127.0.0.1:1');
    await assert.rejects(restoreBackup(options(backupPath, 'other')), ConfirmationRequired);
    await assert.rejects(fs.stat(path.join(dir, 'uploads')));
  });

  it('never extracts into a folder that already has files', async () => {
    const backupPath = await fakeBackup();
    const uploads = path.join(dir, 'uploads');
    await fs.mkdir(uploads);
    await fs.writeFile(path.join(uploads, 'precious'), 'x');
    await assert.rejects(restoreBackup(options(backupPath, 'linkord', uploads)), (err: unknown) => err instanceof BackupError && !(err instanceof ConfirmationRequired) && /not empty/.test(err.message));
    assert.equal(await fs.readFile(path.join(uploads, 'precious'), 'utf8'), 'x');
  });

  it('checks the backup before the target, so a damaged backup is reported first', async () => {
    const backupPath = await fakeBackup();
    await fs.writeFile(path.join(backupPath, DUMP_FILE), 'changed');
    await assert.rejects(restoreBackup(options(backupPath, undefined)), /does not match the checksum/);
  });
});

describe('createBackup guards', () => {
  it('refuses a backup folder inside the uploads folder, which would archive every backup into the next', async () => {
    const uploads = path.join(dir, 'uploads');
    await assert.rejects(
      createBackup({ databaseUrl: UNREACHABLE, uploadDir: uploads, backupDir: path.join(uploads, 'backups'), keep: 7 }),
      /inside the uploads folder/,
    );
    await assert.rejects(createBackup({ databaseUrl: UNREACHABLE, uploadDir: uploads, backupDir: uploads, keep: 7 }), /inside the uploads folder/);
  });

  it('leaves no unfinished folder behind when the database cannot be reached', async () => {
    const backups = path.join(dir, 'backups');
    await assert.rejects(createBackup({ databaseUrl: UNREACHABLE, uploadDir: path.join(dir, 'uploads'), backupDir: backups, keep: 7 }), /Cannot connect/);
    assert.deepEqual(await fs.readdir(backups), []);
  });
});
