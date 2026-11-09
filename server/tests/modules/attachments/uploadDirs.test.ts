import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { unwritableUploadDirs } from '../../../src/modules/attachments/uploadSession.js';

// root can write anywhere, so permissions cannot be tested as root
const asRoot = process.getuid?.() === 0;
const created: string[] = [];

function uploadDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linkord-uploads-'));
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) {
    fs.chmodSync(dir, 0o755);
    if (fs.existsSync(path.join(dir, 'tmp'))) fs.chmodSync(path.join(dir, 'tmp'), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('unwritableUploadDirs', () => {
  it('a writable folder, with or without tmp/, is fine', async () => {
    const dir = uploadDir();
    assert.deepEqual(await unwritableUploadDirs(dir), []);
    fs.mkdirSync(path.join(dir, 'tmp'));
    assert.deepEqual(await unwritableUploadDirs(dir), []);
  });

  it('names a tmp/ left read-only while its parent is writable', { skip: asRoot }, async () => {
    const dir = uploadDir();
    fs.mkdirSync(path.join(dir, 'tmp'));
    fs.chmodSync(path.join(dir, 'tmp'), 0o555);
    assert.deepEqual(await unwritableUploadDirs(dir), [path.join(dir, 'tmp')]);
  });

  it('names a read-only upload folder', { skip: asRoot }, async () => {
    const dir = uploadDir();
    fs.chmodSync(dir, 0o555);
    assert.deepEqual(await unwritableUploadDirs(dir), [dir]);
  });
});
