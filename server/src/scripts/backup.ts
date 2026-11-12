import { BackupError } from './backup/backupLayout.js';
import { createBackup } from './backup/createBackup.js';
import { backupSettings } from './backup/settings.js';

// `npm run backup`
//
// One backup = one folder in BACKUP_DIR (default ./backups), named by UTC time:
//   linkord-backup-20261108T015300Z/
//     database.dump    pg_dump, custom format
//     uploads.tar.gz   UPLOAD_DIR without tmp/ (chunks of unfinished uploads) and exports/ (data exports)
//     manifest.json    row counts, checksums, what the restore will check
// then everything but the newest BACKUP_KEEP (default 7) is deleted.
//
// It only reads the configured DATABASE_URL and UPLOAD_DIR, never writes to
// them, and is safe to run while the app is serving people. Needs pg_dump
// (PostgreSQL client tools, at least the server's major version; PG_DUMP_BIN
// overrides the path) and tar. How it keeps the database and files consistent
// is explained in createBackup.ts and docs/DEVELOPMENT.md#backup-and-restore.

async function main(): Promise<number> {
  const settings = backupSettings();
  console.log(`Backing up ${settings.target} and ${settings.uploadDir} into ${settings.backupDir} (keeping ${settings.keep})`);
  const result = await createBackup({ ...settings, log: (message) => console.log(`  ${message}`) });
  console.log(`Backup written to ${result.dir}`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(err instanceof BackupError ? `Backup failed: ${err.message}` : err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  });
