import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import yauzl from 'yauzl';
import {
  BACKUP_FORMAT, BackupError, DUMP_FILE, isSafeArchiveEntry, MANIFEST_FILE, parseManifest, README_FILE, UPLOADS_PREFIX, UploadsDigest,
  type BackupManifest,
} from './backupLayout.js';

// Reading a backup ZIP (backupZip.ts writes it). Every entry is read through once
// to check it against the manifest before a restore touches anything, then read
// again to restore it: ZIP readers do not check CRC-32, so the checksums in the
// manifest are what tells a damaged download from a good one.

const MANIFEST_LIMIT = 16 * 1024 * 1024;

type Visit = (entry: yauzl.Entry, open: () => Promise<Readable>) => Promise<'stop' | void>;

/** Calls `visit` for each entry in order, one at a time; `visit` may stop early. */
async function eachEntry(zipPath: string, visit: Visit): Promise<void> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, z) => (
    err ? reject(new BackupError(`${zipPath} is not a readable ZIP: ${err.message}`)) : resolve(z!)
  )));
  const open = (entry: yauzl.Entry) => () => new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream!))));
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', (err: Error) => reject(new BackupError(`${zipPath} is damaged: ${err.message}`)));
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        visit(entry, open(entry)).then((next) => (next === 'stop' ? resolve() : zip.readEntry()), reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

/** The path under uploads/ an entry restores to, null for a folder entry. Refuses anything else. */
function uploadPath(name: string): string | null {
  const relative = name.slice(UPLOADS_PREFIX.length);
  if (relative === '' || name.endsWith('/')) return null;
  if (!isSafeArchiveEntry(relative)) throw new BackupError(`The backup contains an unsafe path ("${name}"); refusing to use it.`);
  return relative;
}

async function drain(stream: Readable, onChunk: (chunk: Buffer) => void): Promise<void> {
  for await (const chunk of stream) onChunk(chunk as Buffer);
}

/** Reads the whole ZIP and proves it is the backup its manifest describes. */
export async function readBackupZip(zipPath: string): Promise<BackupManifest> {
  let manifestText: string | null = null;
  let dumpSha: string | null = null;
  const digest = new UploadsDigest();
  let files = 0;
  await eachEntry(zipPath, async (entry, open) => {
    const name = entry.fileName;
    if (name === MANIFEST_FILE) {
      if (entry.uncompressedSize > MANIFEST_LIMIT) throw new BackupError(`${MANIFEST_FILE} is too large to be a manifest.`);
      const chunks: Buffer[] = [];
      await drain(await open(), (chunk) => chunks.push(chunk));
      manifestText = Buffer.concat(chunks).toString('utf8');
    } else if (name === DUMP_FILE) {
      const hash = crypto.createHash('sha256');
      await drain(await open(), (chunk) => hash.update(chunk));
      dumpSha = hash.digest('hex');
    } else if (name.startsWith(UPLOADS_PREFIX)) {
      const relative = uploadPath(name);
      if (relative === null) return;
      digest.begin(relative, entry.uncompressedSize);
      await drain(await open(), (chunk) => digest.update(chunk));
      files++;
    } else if (name !== README_FILE) {
      throw new BackupError(`The ZIP has an entry a backup never has ("${name}"); it is not an Overcord backup.`);
    }
  });
  if (manifestText === null) throw new BackupError(`${zipPath} has no ${MANIFEST_FILE}; it is not a finished backup.`);
  const manifest = parseManifest(manifestText);
  if (manifest.format !== BACKUP_FORMAT) throw new BackupError(`${MANIFEST_FILE} says format ${manifest.format}, which is a folder, not a ZIP.`);
  if (dumpSha !== manifest.sha256.dump) throw new BackupError(`${DUMP_FILE} is missing or does not match the checksum in the manifest; the backup is damaged.`);
  if (files !== manifest.uploads.files || digest.digest() !== manifest.sha256.uploads) {
    throw new BackupError('The stored files do not match the checksum in the manifest; the backup is damaged.');
  }
  return manifest;
}

/** Runs `use` with the database dump as a stream, straight out of the ZIP. */
export async function withDumpStream<T>(zipPath: string, use: (dump: Readable) => Promise<T>): Promise<T> {
  let result: { value: T } | null = null;
  await eachEntry(zipPath, async (entry, open) => {
    if (entry.fileName !== DUMP_FILE) return;
    result = { value: await use(await open()) };
    return 'stop';
  });
  if (!result) throw new BackupError(`${zipPath} has no ${DUMP_FILE}.`);
  return (result as { value: T }).value;
}

/** Writes every stored file into `uploadDir` (never over an existing one) and checks them against the
 * manifest again on the way. Returns how many files it wrote. */
export async function extractBackupUploads(zipPath: string, uploadDir: string, expected: string | null): Promise<number> {
  await fsp.mkdir(uploadDir, { recursive: true });
  const digest = new UploadsDigest();
  let files = 0;
  await eachEntry(zipPath, async (entry, open) => {
    if (!entry.fileName.startsWith(UPLOADS_PREFIX)) return;
    const relative = uploadPath(entry.fileName);
    if (relative === null) return;
    const target = path.join(uploadDir, ...relative.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    digest.begin(relative, entry.uncompressedSize);
    const through = new Transform({ transform(chunk: Buffer, _encoding, done) { digest.update(chunk); done(null, chunk); } });
    await pipeline(await open(), through, fs.createWriteStream(target, { flags: 'wx' }));
    files++;
  });
  if (digest.digest() !== expected) throw new BackupError('The stored files changed while they were being restored; the backup file is damaged or was modified.');
  return files;
}

/** Entry names in order, without reading any data. */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const names: string[] = [];
  await eachEntry(zipPath, async (entry) => { names.push(entry.fileName); });
  return names;
}
