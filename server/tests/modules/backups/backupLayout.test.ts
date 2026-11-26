import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BackupError, backupFileName, BACKUP_FORMAT, isSafeArchiveEntry, parseManifest, UploadsDigest, type BackupManifest,
} from '../../../src/modules/backups/backupLayout.js';

const manifest = (format = BACKUP_FORMAT): BackupManifest => ({
  format, createdAt: '2026-11-08T01:53:00.000Z',
  database: { name: 'overcord', serverVersion: '17.2', dumpTool: 'pg_dump 17.2' },
  migrations: 52, tables: { users: 2, messages: 10 },
  uploads: { files: 3, bytes: 1000, missingFromArchive: 0 },
  sha256: { dump: 'a'.repeat(64), uploads: null },
});

describe('backupFileName', () => {
  it('is the UTC time, so names sort by time whatever the host timezone', () => {
    assert.equal(backupFileName(new Date('2026-11-08T01:53:09.999Z')), 'overcord-backup-20261108T015309Z.zip');
    assert.ok(backupFileName(new Date('2026-01-01T00:00:00Z')) < backupFileName(new Date('2026-12-31T23:59:59Z')));
  });
});

describe('parseManifest', () => {
  it('reads a ZIP manifest and the folder manifest older versions wrote', () => {
    assert.deepEqual(parseManifest(JSON.stringify(manifest())), manifest());
    assert.deepEqual(parseManifest(JSON.stringify(manifest(1))), manifest(1));
  });

  it('refuses damaged, foreign and newer-format manifests', () => {
    assert.throws(() => parseManifest('{nope'), /not valid JSON/);
    assert.throws(() => parseManifest('null'), BackupError);
    assert.throws(() => parseManifest(JSON.stringify({ ...manifest(), format: 3 })), /format 3/);
    assert.throws(() => parseManifest(JSON.stringify({ ...manifest(), sha256: { dump: 'short', uploads: null } })), /incomplete or damaged/);
    assert.throws(() => parseManifest(JSON.stringify({ ...manifest(), tables: { users: -1 } })), /incomplete or damaged/);
    const { migrations: _omitted, ...withoutMigrations } = manifest();
    assert.throws(() => parseManifest(JSON.stringify(withoutMigrations)), /incomplete or damaged/);
  });
});

describe('UploadsDigest', () => {
  const digestOf = (files: [string, string][]) => {
    const digest = new UploadsDigest();
    for (const [name, content] of files) {
      digest.begin(name, Buffer.byteLength(content));
      // the same bytes in any chunking hash the same
      for (const char of content) digest.update(Buffer.from(char));
    }
    return digest.digest();
  };

  it('is null with no files', () => {
    assert.equal(digestOf([]), null);
  });

  it('changes with any byte, any name and the order of the files', () => {
    const base = digestOf([['a', 'one'], ['b', 'two']]);
    assert.match(base!, /^[0-9a-f]{64}$/);
    assert.equal(digestOf([['a', 'one'], ['b', 'two']]), base);
    assert.notEqual(digestOf([['a', 'one'], ['b', 'twO']]), base);
    assert.notEqual(digestOf([['a', 'one'], ['c', 'two']]), base);
    assert.notEqual(digestOf([['b', 'two'], ['a', 'one']]), base);
    // moving bytes from one file to the next is not the same backup
    assert.notEqual(digestOf([['a', 'onet'], ['b', 'wo']]), base);
  });
});

describe('isSafeArchiveEntry', () => {
  it('flags paths that could leave the folder they are extracted into', () => {
    assert.equal(isSafeArchiveEntry('a'.repeat(32)), true);
    assert.equal(isSafeArchiveEntry('sub/file'), true);
    for (const bad of ['/etc/passwd', '../outside', 'a/../../b', 'a\\b', 'C:evil', '']) assert.equal(isSafeArchiveEntry(bad), false, bad);
  });
});
