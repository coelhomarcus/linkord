import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { afterEach, beforeEach, describe, it } from 'node:test';
import yazl from 'yazl';
import {
  BackupError, DUMP_FILE, MANIFEST_FILE, README_FILE, UploadsDigest, type BackupManifest,
} from '../../../src/modules/backups/backupLayout.js';
import { writeBackupFile, writeBackupZip } from '../../../src/modules/backups/backupZip.js';
import { extractBackupUploads } from '../../../src/modules/backups/backupZipReader.js';
import { ConfirmationRequired, readBackup, restoreBackup } from '../../../src/modules/backups/restoreBackup.js';

// Nothing here reaches a database: every case is refused before the first
// connection, which is the point of the guards.
const UNREACHABLE = 'postgres://nobody:secret@127.0.0.1:1/overcord';
const A = 'a'.repeat(32);

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'overcord-restore-test-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

const sha = (data: string) => crypto.createHash('sha256').update(data).digest('hex');

function manifestFor(dump: string, files: [string, string][], format = 2): BackupManifest {
  const digest = new UploadsDigest();
  for (const [name, content] of files) { digest.begin(name, Buffer.byteLength(content)); digest.update(Buffer.from(content)); }
  return {
    format, createdAt: '2026-11-08T01:53:00.000Z', database: { name: 'overcord', serverVersion: '17', dumpTool: 'pg_dump' },
    migrations: 1, tables: { users: 1 }, uploads: { files: files.length, bytes: files.reduce((n, [, c]) => n + c.length, 0), missingFromArchive: 0 },
    sha256: { dump: sha(dump), uploads: digest.digest() },
  };
}

/** A ZIP laid out like backupZip.ts writes one, with `change` applied to the entries before writing. */
async function fakeZip(options: { dump?: string; files?: [string, string][]; change?: (entries: [string, string][]) => [string, string][] } = {}): Promise<string> {
  const dump = options.dump ?? 'PGDMP fake';
  const files = options.files ?? [[A, 'first file'], ['nested/odd name.txt', 'second']];
  let entries: [string, string][] = [
    [README_FILE, 'readme'], [DUMP_FILE, dump], ...files.map(([name, content]): [string, string] => [`uploads/${name}`, content]),
    [MANIFEST_FILE, JSON.stringify(manifestFor(dump, files))],
  ];
  if (options.change) entries = options.change(entries);
  const zip = new yazl.ZipFile();
  for (const [name, content] of entries) zip.addBuffer(Buffer.from(content), name, { compress: false });
  const file = path.join(dir, `backup-${crypto.randomUUID()}.zip`);
  const out = createWriteStream(file);
  zip.outputStream.pipe(out);
  zip.end();
  await finished(out);
  return file;
}

async function fakeFolder(dumpBytes = 'PGDMP fake'): Promise<string> {
  const folder = path.join(dir, 'overcord-backup-20261108T015300Z');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, DUMP_FILE), dumpBytes);
  await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify(manifestFor(dumpBytes, [], 1)));
  return folder;
}

describe('readBackup of a ZIP', () => {
  it('accepts a backup whose entries match the manifest', async () => {
    const source = await readBackup(await fakeZip());
    assert.equal(source.kind, 'zip');
    assert.equal(source.manifest.uploads.files, 2);
  });

  it('refuses a dump or a stored file that changed', async () => {
    await assert.rejects(readBackup(await fakeZip({ change: (e) => e.map(([n, c]) => [n, n === DUMP_FILE ? 'PGDMP tampered' : c]) })), /database\.dump .*checksum/);
    await assert.rejects(readBackup(await fakeZip({ change: (e) => e.map(([n, c]) => [n, n === `uploads/${A}` ? 'first fil3' : c]) })), /stored files do not match/);
    await assert.rejects(readBackup(await fakeZip({ change: (e) => e.filter(([n]) => n !== `uploads/${A}`) })), /stored files do not match/);
  });

  it('refuses a ZIP that is not a backup', async () => {
    await assert.rejects(readBackup(await fakeZip({ change: (e) => e.filter(([n]) => n !== MANIFEST_FILE) })), /not a finished backup/);
    await assert.rejects(readBackup(await fakeZip({ change: (e) => [...e, ['photos/cat.jpg', 'x']] })), /not an Overcord backup/);
    const notZip = path.join(dir, 'notes.zip');
    await fs.writeFile(notZip, 'plain text');
    await assert.rejects(readBackup(notZip), /not a readable ZIP/);
    await assert.rejects(readBackup(path.join(dir, 'missing.zip')), /does not exist/);
  });

  it('refuses a stored file whose path would leave the uploads folder', async () => {
    // ZIP writers refuse such a name, so it is patched into the bytes, as a crafted file would have it
    const zip = await fakeZip({ files: [['zz/escape', 'x']] });
    const bytes = await fs.readFile(zip);
    await fs.writeFile(zip, Buffer.from(bytes.toString('latin1').replaceAll('uploads/zz/', 'uploads/../'), 'latin1'));
    await assert.rejects(readBackup(zip), BackupError);
  });
});

describe('readBackup of a folder written by an older version', () => {
  it('accepts a folder whose files match the manifest', async () => {
    const source = await readBackup(await fakeFolder());
    assert.equal(source.kind, 'folder');
    assert.equal(source.kind === 'folder' && source.uploadsFile, null);
  });

  it('refuses a dump that changed, or that is gone', async () => {
    const folder = await fakeFolder();
    await fs.writeFile(path.join(folder, DUMP_FILE), 'PGDMP tampered');
    await assert.rejects(readBackup(folder), /does not match the checksum/);
    await fs.rm(path.join(folder, DUMP_FILE));
    await assert.rejects(readBackup(folder), /missing or does not match/);
  });

  it('refuses an uploads archive the manifest promises but that is not there', async () => {
    const folder = await fakeFolder();
    const manifest = JSON.parse(await fs.readFile(path.join(folder, MANIFEST_FILE), 'utf8')) as BackupManifest;
    manifest.sha256.uploads = 'f'.repeat(64);
    await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify(manifest));
    await assert.rejects(readBackup(folder), /uploads\.tar\.gz is missing/);
  });

  it('refuses a folder with no manifest, or with a ZIP manifest', async () => {
    await assert.rejects(readBackup(dir), /not a finished backup/);
    const folder = await fakeFolder();
    await fs.writeFile(path.join(folder, MANIFEST_FILE), JSON.stringify(manifestFor('PGDMP fake', [], 2)));
    await assert.rejects(readBackup(folder), /which is a ZIP/);
  });
});

describe('extractBackupUploads', () => {
  it('writes every stored file, nested ones too, and never over an existing file', async () => {
    const zip = await fakeZip();
    const manifest = (await readBackup(zip)).manifest;
    const uploads = path.join(dir, 'uploads');
    assert.equal(await extractBackupUploads(zip, uploads, manifest.sha256.uploads), 2);
    assert.equal(await fs.readFile(path.join(uploads, A), 'utf8'), 'first file');
    assert.equal(await fs.readFile(path.join(uploads, 'nested', 'odd name.txt'), 'utf8'), 'second');
    await assert.rejects(extractBackupUploads(zip, uploads, manifest.sha256.uploads), /EEXIST/);
  });
});

describe('restoreBackup guards', () => {
  const options = (backupPath: string, confirm: string | undefined, uploadDir = path.join(dir, 'uploads')) => ({ backupPath, databaseUrl: UNREACHABLE, uploadDir, confirm });

  it('does nothing without the database name typed back, and says which database it would use', async () => {
    const backupPath = await fakeZip();
    await assert.rejects(restoreBackup(options(backupPath, undefined)), (err: unknown) => err instanceof ConfirmationRequired && err.database === 'overcord' && err.target === '127.0.0.1:1');
    await assert.rejects(restoreBackup(options(backupPath, 'other')), ConfirmationRequired);
    await assert.rejects(fs.stat(path.join(dir, 'uploads')));
  });

  it('never extracts into a folder that already has files', async () => {
    const backupPath = await fakeZip();
    const uploads = path.join(dir, 'uploads');
    await fs.mkdir(uploads);
    await fs.writeFile(path.join(uploads, 'precious'), 'x');
    await assert.rejects(restoreBackup(options(backupPath, 'overcord', uploads)), (err: unknown) => err instanceof BackupError && !(err instanceof ConfirmationRequired) && /not empty/.test(err.message));
    assert.equal(await fs.readFile(path.join(uploads, 'precious'), 'utf8'), 'x');
  });

  it('checks the backup before the target, so a damaged backup is reported first', async () => {
    const backupPath = await fakeZip({ change: (e) => e.map(([n, c]) => [n, n === DUMP_FILE ? 'changed' : c]) });
    await assert.rejects(restoreBackup(options(backupPath, undefined)), /does not match the checksum/);
  });
});

describe('writeBackupZip guards', () => {
  it('fails without a database and destroys its output, so a download never looks complete', async () => {
    const out = new PassThrough();
    out.resume();
    await assert.rejects(writeBackupZip(out, { databaseUrl: UNREACHABLE, uploadDir: path.join(dir, 'uploads') }), /Cannot connect/);
    assert.equal(out.destroyed, true);
  });

  it('does not start when it was already cancelled', async () => {
    const stop = new AbortController();
    stop.abort();
    await assert.rejects(writeBackupZip(new PassThrough(), { databaseUrl: UNREACHABLE, uploadDir: dir, signal: stop.signal }), /cancelled/);
  });

  it('leaves neither the file nor its .partial behind when it fails, and never overwrites a file', async () => {
    const file = path.join(dir, 'backup.zip');
    await assert.rejects(writeBackupFile(file, { databaseUrl: UNREACHABLE, uploadDir: path.join(dir, 'uploads') }), /Cannot connect/);
    assert.deepEqual(await fs.readdir(dir), []);
    await fs.writeFile(file, 'an older backup');
    await assert.rejects(writeBackupFile(file, { databaseUrl: UNREACHABLE, uploadDir: path.join(dir, 'uploads') }), /already exists/);
    assert.equal(await fs.readFile(file, 'utf8'), 'an older backup');
  });
});
