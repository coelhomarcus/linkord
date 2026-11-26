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
// manifest are what tells a damaged download from a good one. They are not a
// signature: nothing here tells an altered backup from a genuine one, and
// pg_restore runs whatever SQL the dump holds as the DATABASE_URL user. Only
// restore a backup you kept yourself.

const MANIFEST_LIMIT = 16 * 1024 * 1024;

type Visit = (entry: yauzl.Entry, open: () => Promise<Readable>) => Promise<'stop' | void>;

/** Calls `visit` for each entry in order, one at a time; `visit` may stop early. A name that appears twice is
 * refused: one pass could check the first copy while another restores the second. */
async function eachEntry(zipPath: string, visit: Visit): Promise<void> {
  const seen = new Set<string>();
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, z) => (
    err ? reject(new BackupError(`${zipPath} is not a readable ZIP: ${err.message}`)) : resolve(z!)
  )));
  const open = (entry: yauzl.Entry) => () => new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream!))));
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', (err: Error) => reject(new BackupError(`${zipPath} is damaged: ${err.message}`)));
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (seen.has(entry.fileName)) return reject(new BackupError(`The ZIP holds "${entry.fileName}" twice; it is not a backup this server wrote.`));
        seen.add(entry.fileName);
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

/** Reads the whole ZIP and checks it against its manifest. That catches a damaged file (a broken download,
 * a bad disk), not a deliberate change: whoever edits the ZIP can rewrite the manifest too. */
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

/** `source` as it is, except that its last chunk is held back until the whole stream hashes to `sha256`. On a
 * mismatch the stream fails before its end, so pg_restore, which needs the end of the dump to finish, fails
 * and its single transaction rolls back: a dump that changed after it was checked is never committed. */
export function verifiedDump(source: Readable, sha256: string): Readable {
  const hash = crypto.createHash('sha256');
  let held: Buffer | null = null;
  const verify = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      const previous = held;
      held = chunk;
      done(null, previous ?? undefined);
    },
    flush(done) {
      if (hash.digest('hex') !== sha256) return done(new BackupError(`${DUMP_FILE} changed after it was checked; nothing was restored.`));
      done(null, held ?? undefined);
    },
  });
  source.on('error', (err) => verify.destroy(err));
  return source.pipe(verify);
}

/** Runs `use` with the database dump as a stream, straight out of the ZIP, checked against `sha256` again
 * as it is read (see verifiedDump). */
export async function withDumpStream<T>(zipPath: string, sha256: string, use: (dump: Readable) => Promise<T>): Promise<T> {
  let result: { value: T } | null = null;
  await eachEntry(zipPath, async (entry, open) => {
    if (entry.fileName !== DUMP_FILE) return;
    result = { value: await use(verifiedDump(await open(), sha256)) };
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
  if (digest.digest() !== expected) throw new BackupError('The stored files changed while they were being restored; the backup file is damaged.');
  return files;
}

/** Entry names in order, without reading any data. */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const names: string[] = [];
  await eachEntry(zipPath, async (entry) => { names.push(entry.fileName); });
  return names;
}
