import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  BackupError, backupName, BACKUP_FORMAT, listBackups, MANIFEST_FILE, parseKeep, parseManifest, resolveBackup, rotateBackups, type BackupManifest,
} from '../../../src/scripts/backup/backupLayout.js';

const manifest = (): BackupManifest => ({
  format: BACKUP_FORMAT, createdAt: '2026-11-08T01:53:00.000Z',
  database: { name: 'linkord', serverVersion: '17.2', dumpTool: 'pg_dump 17.2' },
  migrations: 52, tables: { users: 2, messages: 10 },
  uploads: { files: 3, bytes: 1000, missingFromArchive: 0 },
  sha256: { dump: 'a'.repeat(64), uploads: null },
});

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkord-backup-test-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

async function makeBackup(name: string): Promise<string> {
  const folder = path.join(dir, name);
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify(manifest()));
  await fs.writeFile(path.join(folder, 'database.dump'), name);
  return folder;
}
const names = async (): Promise<string[]> => (await fs.readdir(dir)).sort();

describe('backupName', () => {
  it('is the UTC time, so names sort by time whatever the host timezone', () => {
    assert.equal(backupName(new Date('2026-11-08T01:53:09.999Z')), 'linkord-backup-20261108T015309Z');
    assert.ok(backupName(new Date('2026-01-01T00:00:00Z')) < backupName(new Date('2026-12-31T23:59:59Z')));
  });
});

describe('parseKeep', () => {
  it('defaults to 7 and accepts whole numbers from 1', () => {
    assert.equal(parseKeep(undefined), 7);
    assert.equal(parseKeep(' '), 7);
    assert.equal(parseKeep('30'), 30);
  });

  it('rejects 0, negatives and anything that is not a whole number, so a typo cannot wipe the history', () => {
    for (const bad of ['0', '-1', '1.5', 'abc', '5 days']) assert.throws(() => parseKeep(bad), BackupError);
  });
});

describe('parseManifest', () => {
  it('reads a valid manifest', () => {
    assert.deepEqual(parseManifest(JSON.stringify(manifest())), manifest());
  });

  it('refuses damaged, foreign and newer-format manifests', () => {
    assert.throws(() => parseManifest('{nope'), /not valid JSON/);
    assert.throws(() => parseManifest('null'), BackupError);
    assert.throws(() => parseManifest(JSON.stringify({ ...manifest(), format: 2 })), /format 2/);
    assert.throws(() => parseManifest(JSON.stringify({ ...manifest(), sha256: { dump: 'short', uploads: null } })), /incomplete or damaged/);
    assert.throws(() => parseManifest(JSON.stringify({ ...manifest(), tables: { users: -1 } })), /incomplete or damaged/);
    const { migrations: _omitted, ...withoutMigrations } = manifest();
    assert.throws(() => parseManifest(JSON.stringify(withoutMigrations)), /incomplete or damaged/);
  });
});

describe('rotateBackups', () => {
  it('keeps the newest N and deletes only older backups', async () => {
    for (const day of ['01', '02', '03', '04', '05']) await makeBackup(`linkord-backup-202611${day}T020000Z`);
    const removed = await rotateBackups(dir, 3);
    assert.deepEqual(removed.sort(), ['linkord-backup-20261101T020000Z', 'linkord-backup-20261102T020000Z']);
    assert.deepEqual(await names(), ['linkord-backup-20261103T020000Z', 'linkord-backup-20261104T020000Z', 'linkord-backup-20261105T020000Z']);
  });

  it('does nothing while there are N or fewer', async () => {
    await makeBackup('linkord-backup-20261101T020000Z');
    assert.deepEqual(await rotateBackups(dir, 7), []);
    assert.equal((await names()).length, 1);
  });

  it('never touches names that are not backups, nor a folder without a manifest', async () => {
    for (const day of ['01', '02', '03']) await makeBackup(`linkord-backup-202611${day}T020000Z`);
    await fs.writeFile(path.join(dir, 'notes.txt'), 'mine');
    await fs.mkdir(path.join(dir, 'linkord-backup-old-copy'));
    await fs.mkdir(path.join(dir, 'linkord-backup-20260101T000000Z'));
    await fs.writeFile(path.join(dir, 'linkord-backup-20260101T000000Z', 'database.dump'), 'no manifest: not a finished backup');
    await rotateBackups(dir, 1);
    assert.deepEqual(await names(), ['linkord-backup-20260101T000000Z', 'linkord-backup-20261103T020000Z', 'linkord-backup-old-copy', 'notes.txt']);
  });

  it('removes unfinished folders of a crashed run after a day, but not a recent one', async () => {
    await makeBackup('linkord-backup-20261103T020000Z');
    const old = path.join(dir, 'linkord-backup-20261101T020000Z.partial');
    const recent = path.join(dir, 'linkord-backup-20261103T030000Z.partial');
    await fs.mkdir(old);
    await fs.mkdir(recent);
    const now = Date.now();
    await fs.utimes(old, new Date(now - 25 * 3600_000), new Date(now - 25 * 3600_000));
    assert.deepEqual(await rotateBackups(dir, 1, now), ['linkord-backup-20261101T020000Z.partial']);
    assert.ok((await names()).includes('linkord-backup-20261103T030000Z.partial'));
  });

  it('refuses a keep count that would delete everything', async () => {
    await makeBackup('linkord-backup-20261103T020000Z');
    await assert.rejects(rotateBackups(dir, 0), BackupError);
    assert.equal((await names()).length, 1);
  });

  it('works on a folder that does not exist yet', async () => {
    assert.deepEqual(await listBackups(path.join(dir, 'missing')), []);
  });
});

describe('resolveBackup', () => {
  it('finds the newest, a name inside the folder, or a path', async () => {
    const older = await makeBackup('linkord-backup-20261101T020000Z');
    const newer = await makeBackup('linkord-backup-20261102T020000Z');
    assert.equal(await resolveBackup(dir, 'latest'), newer);
    assert.equal(await resolveBackup(dir, 'linkord-backup-20261101T020000Z'), older);
    assert.equal(await resolveBackup('/elsewhere', older), older);
  });

  it('says what is wrong when there is nothing to restore', async () => {
    await assert.rejects(resolveBackup(dir, 'latest'), /No backups found/);
    await assert.rejects(resolveBackup(dir, 'nope'), /not a backup folder/);
  });
});
