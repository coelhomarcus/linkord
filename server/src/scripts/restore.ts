import { parseArgs } from 'node:util';
import { BackupError, resolveBackup } from './backup/backupLayout.js';
import { ConfirmationRequired, restoreBackup } from './backup/restoreBackup.js';
import { backupSettings } from './backup/settings.js';

// `npm run restore -- [<backup>|latest] --confirm <database-name> [--strict]`
//
// Restores a backup into the configured DATABASE_URL and UPLOAD_DIR, then
// checks that what came back is what the backup held (every table's row count,
// the migrations, the files, and the same attachments-versus-disk comparison
// the admin "System" page shows).
//
// It is built to be hard to point at the wrong place:
//   - the target is only ever DATABASE_URL / UPLOAD_DIR, there is no flag for another;
//   - --confirm must repeat the name of that database;
//   - the database must have no tables and the uploads folder no files;
//   - the backup's checksums are verified before anything is touched;
//   - pg_restore runs in one transaction, so a failure leaves the database empty.
// Stop the app first. Exit codes: 0 restored and verified, 1 failed, 2 not
// confirmed or bad usage, 3 restored but the check found a mismatch (or a
// warning, with --strict).

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true,
    options: { confirm: { type: 'string' }, strict: { type: 'boolean', default: false } },
  });
  if (positionals.length > 1) { console.error('usage: npm run restore -- [<backup>|latest] --confirm <database-name> [--strict]'); return 2; }
  const settings = backupSettings();
  const backupPath = await resolveBackup(settings.backupDir, positionals[0] ?? 'latest');

  console.log(`Restoring ${backupPath}\n  into database ${settings.target}\n  and uploads folder ${settings.uploadDir}`);
  try {
    const { manifest, integrity } = await restoreBackup({ ...settings, backupPath, confirm: values.confirm, log: (message) => console.log(`  ${message}`) });
    console.log(`\nBackup taken ${manifest.createdAt} (${Object.keys(manifest.tables).length} tables, ${manifest.uploads.files} files)`);
    console.log(`Files: ${integrity.tracked} attachments with their file, ${integrity.missingFiles} without, ${integrity.orphanFiles} files without a row`);
    for (const warning of integrity.warnings) console.log(`warning: ${warning}`);
    for (const error of integrity.errors) console.error(`MISMATCH: ${error}`);
    if (integrity.errors.length > 0 || (values.strict && integrity.warnings.length > 0)) {
      console.error('\nThe restore finished, but the check did not pass.');
      return 3;
    }
    console.log('\nRestore verified. Start the app; it applies no migrations because the restored database already has them all.');
    return 0;
  } catch (err) {
    if (!(err instanceof ConfirmationRequired)) throw err;
    console.error(`\nNothing was changed. ${err.message}\nTo go ahead, run the same command again with:  --confirm ${err.database}`);
    return 2;
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => {
    console.error(err instanceof BackupError ? `Restore failed: ${err.message}` : err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  });
