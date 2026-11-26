import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { BackupError, backupFileName } from '../modules/backups/backupLayout.js';
import { writeBackupFile, writeBackupZip } from '../modules/backups/backupZip.js';
import { backupSettings } from '../modules/backups/settings.js';

// `bun run backup --out <file.zip>`   or   `bun run backup > <file.zip>`
//
// Writes one full backup as a ZIP: the database (pg_dump, custom format), every
// stored file of UPLOAD_DIR (without tmp/ and exports/) and a manifest with the
// checksums the restore checks. Nothing is kept on the server: with --out the
// ZIP goes to that file (written as <file>.partial and renamed when complete,
// never over an existing file); without it, to stdout, so a host can pull it out
// of a container with `docker exec <container> bun ... backup.js > backup.zip`.
// `--out` may name a folder, in which case the file is named by the UTC time.
// Messages go to stderr.
//
// It only reads the configured DATABASE_URL and UPLOAD_DIR, never writes to
// them, and is safe to run while the app is serving people. Needs pg_dump
// (PostgreSQL client tools, at least the server's major version; PG_DUMP_BIN
// overrides the path). How it keeps the database and files consistent is
// explained in modules/backups/backupZip.ts.

async function main(): Promise<number> {
  const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: 'string' } } });
  const settings = backupSettings();
  const log = (message: string) => console.error(`  ${message}`);
  if (values.out === undefined) {
    if (process.stdout.isTTY) {
      console.error('usage: bun run backup --out <file.zip>   (or redirect stdout to a file: bun run backup > backup.zip)');
      return 2;
    }
    console.error(`Backing up ${settings.target} and ${settings.uploadDir} to stdout`);
    const { bytes } = await writeBackupZip(process.stdout, { ...settings, log });
    console.error(`Backup written (${bytes} bytes)`);
    return 0;
  }
  let file = path.resolve(values.out);
  if (values.out.endsWith('/') || await fsp.stat(file).then((s) => s.isDirectory(), () => false)) {
    await fsp.mkdir(file, { recursive: true });
    file = path.join(file, backupFileName(new Date()));
  }
  console.error(`Backing up ${settings.target} and ${settings.uploadDir} into ${file}`);
  const { bytes } = await writeBackupFile(file, { ...settings, log });
  console.error(`Backup written to ${file} (${bytes} bytes)`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(err instanceof BackupError ? `Backup failed: ${err.message}` : err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  });
