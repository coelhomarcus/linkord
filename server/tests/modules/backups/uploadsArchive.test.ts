import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BackupError } from '../../../src/modules/backups/backupLayout.js';
import { runTool } from '../../../src/modules/backups/postgresTools.js';
import { extractUploadsArchive, isEmptyDirectory, listArchive, listStoredFiles, listUploadFiles } from '../../../src/modules/backups/uploadsArchive.js';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'overcord-archive-test-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

describe('listUploadFiles', () => {
  it('lists every stored file, nested ones too, without tmp/, exports/, lost+found and links', async () => {
    const uploads = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploads, 'tmp', 'session1'), { recursive: true });
    await fs.writeFile(path.join(uploads, 'tmp', 'session1', '000000'), 'half an upload');
    await fs.mkdir(path.join(uploads, 'exports'), { recursive: true });
    await fs.writeFile(path.join(uploads, 'exports', '6f1c1a52-3b55-4a5e-9a51-7f7f7f7f7f7f.zip'), 'someone\'s data');
    await fs.mkdir(path.join(uploads, 'lost+found'));
    await fs.mkdir(path.join(uploads, 'nested', 'tmp'), { recursive: true });
    await fs.writeFile(path.join(uploads, 'nested', 'tmp', 'kept'), 'only the top-level tmp/ is skipped');
    await fs.writeFile(path.join(uploads, B), 'second file');
    await fs.writeFile(path.join(uploads, A), 'first file');
    await fs.writeFile(path.join(uploads, 'name with spaces.txt'), 'odd name');
    await fs.symlink('/etc/hosts', path.join(uploads, 'link'));
    assert.deepEqual(await listUploadFiles(uploads), [A, B, 'name with spaces.txt', 'nested/tmp/kept']);
  });

  it('leaves out the configured EXPORT_DIR wherever it is inside the folder, and ignores one outside it', async () => {
    const uploads = path.join(dir, 'uploads');
    await fs.mkdir(path.join(uploads, 'private', 'copies'), { recursive: true });
    await fs.writeFile(path.join(uploads, 'private', 'copies', '6f1c1a52-3b55-4a5e-9a51-7f7f7f7f7f7f.zip'), 'someone\'s data');
    await fs.writeFile(path.join(uploads, 'private', 'kept'), 'next to it, kept');
    await fs.writeFile(path.join(uploads, A), 'stored');
    assert.deepEqual(await listUploadFiles(uploads, [path.join(uploads, 'private', 'copies')]), [A, 'private/kept']);
    assert.deepEqual(await listUploadFiles(uploads, [path.join(dir, 'elsewhere'), uploads]), [A, 'private/copies/6f1c1a52-3b55-4a5e-9a51-7f7f7f7f7f7f.zip', 'private/kept']);
  });

  it('is empty for a folder that does not exist yet', async () => {
    assert.deepEqual(await listUploadFiles(path.join(dir, 'missing')), []);
  });
});

describe('extractUploadsArchive (folder backups from older versions)', () => {
  it('extracts the uploads.tar.gz of a folder backup unchanged', async () => {
    const source = path.join(dir, 'source');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, A), 'first file');
    await fs.writeFile(path.join(source, 'name with spaces.txt'), 'odd name');
    const archive = path.join(dir, 'uploads.tar.gz');
    await runTool({ bin: 'tar', args: ['-czf', archive, '-C', source, A, 'name with spaces.txt'], what: 'tar' });
    assert.deepEqual((await listArchive(archive)).sort(), [A, 'name with spaces.txt']);

    const restored = path.join(dir, 'restored');
    assert.equal(await extractUploadsArchive(archive, restored), 2);
    assert.equal(await fs.readFile(path.join(restored, A), 'utf8'), 'first file');
    assert.equal(await fs.readFile(path.join(restored, 'name with spaces.txt'), 'utf8'), 'odd name');
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
