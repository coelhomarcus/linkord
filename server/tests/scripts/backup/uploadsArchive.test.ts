import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BackupError } from '../../../src/scripts/backup/backupLayout.js';
import { createUploadsArchive, extractUploadsArchive, isEmptyDirectory, isSafeArchiveEntry, listArchive, listStoredFiles } from '../../../src/scripts/backup/uploadsArchive.js';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'linkord-archive-test-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

describe('createUploadsArchive / extractUploadsArchive', () => {
  it('archives stored files without tmp/, and extracts them unchanged', async () => {
    const uploads = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploads, 'tmp', 'session1'), { recursive: true });
    await fs.writeFile(path.join(uploads, 'tmp', 'session1', '000000'), 'half an upload');
    await fs.writeFile(path.join(uploads, A), 'first file');
    await fs.writeFile(path.join(uploads, B), 'second file, longer');
    await fs.writeFile(path.join(uploads, 'name with spaces.txt'), 'odd name');

    const archive = path.join(dir, 'uploads.tar.gz');
    const result = await createUploadsArchive(uploads, archive);
    assert.equal(result.files, 3);
    assert.equal(result.bytes, 'first file'.length + 'second file, longer'.length + 'odd name'.length);
    assert.deepEqual([...result.storedNames].sort(), [A, B]);
    assert.match(result.sha256!, /^[0-9a-f]{64}$/);
    assert.deepEqual((await listArchive(archive)).sort(), [A, B, 'name with spaces.txt']);

    const restored = path.join(dir, 'restored');
    assert.equal(await extractUploadsArchive(archive, restored), 3);
    assert.equal(await fs.readFile(path.join(restored, A), 'utf8'), 'first file');
    assert.equal(await fs.readFile(path.join(restored, 'name with spaces.txt'), 'utf8'), 'odd name');
    await assert.rejects(fs.stat(path.join(restored, 'tmp')));
  });

  it('writes no archive for a folder with nothing to keep', async () => {
    const empty = path.join(dir, 'empty');
    await fs.mkdir(path.join(empty, 'tmp'), { recursive: true });
    const archive = path.join(dir, 'out.tar.gz');
    assert.deepEqual(await createUploadsArchive(empty, archive), { sha256: null, files: 0, bytes: 0, storedNames: new Set() });
    await assert.rejects(fs.stat(archive));
    assert.equal((await createUploadsArchive(path.join(dir, 'missing'), archive)).sha256, null);
  });

  it('flags paths that could leave the folder it is extracted into', async () => {
    assert.equal(isSafeArchiveEntry(A), true);
    assert.equal(isSafeArchiveEntry('sub/file'), true);
    for (const bad of ['/etc/passwd', '../outside', 'a/../../b', 'a\\b', 'C:evil', '']) assert.equal(isSafeArchiveEntry(bad), false, bad);
  });

  it('reports a damaged archive instead of extracting half of it', async () => {
    const archive = path.join(dir, 'broken.tar.gz');
    await fs.writeFile(archive, 'this is not a tar file');
    await assert.rejects(extractUploadsArchive(archive, path.join(dir, 'out')), BackupError);
  });
});

describe('listStoredFiles / isEmptyDirectory', () => {
  it('lists only files named like stored ones', async () => {
    await fs.writeFile(path.join(dir, A), 'x');
    await fs.writeFile(path.join(dir, 'notes.txt'), 'x');
    await fs.mkdir(path.join(dir, B));
    assert.deepEqual((await listStoredFiles(dir)).map((f) => f.name), [A]);
    assert.deepEqual(await listStoredFiles(path.join(dir, 'missing')), []);
  });

  it('treats a missing folder and a mounted volume with only lost+found as empty', async () => {
    assert.equal(await isEmptyDirectory(path.join(dir, 'missing')), true);
    await fs.mkdir(path.join(dir, 'lost+found'));
    assert.equal(await isEmptyDirectory(dir), true);
    await fs.writeFile(path.join(dir, A), 'x');
    assert.equal(await isEmptyDirectory(dir), false);
  });
});
