import { config } from '../../config/env.js';
import { BackupError } from './backupLayout.js';
import { pgConnection, type DatabaseSsl } from './postgresTools.js';

// Backups and restores only ever act on the database and uploads folder the
// app itself is configured with (DATABASE_URL, UPLOAD_DIR). There is no flag to
// aim them elsewhere on purpose: a script that dumps or fills a database should
// not have a way to pick the wrong one from a typo.

export interface BackupSettings {
  databaseUrl: string;
  ssl: DatabaseSsl;
  uploadDir: string;
  /** Left out of a backup when it lies inside uploadDir: data exports (EXPORT_DIR). */
  excludedDirs: string[];
  /** "host:port/database", with no credentials, for messages */
  target: string;
}

export function backupSettings(): BackupSettings {
  if (!config.DATABASE_URL) throw new BackupError('DATABASE_URL is not set (see .env.example).');
  const connection = pgConnection(config.DATABASE_URL);
  return {
    databaseUrl: config.DATABASE_URL,
    ssl: { enabled: config.DATABASE_SSL, ca: config.DATABASE_SSL_CA || undefined },
    uploadDir: config.UPLOAD_DIR,
    excludedDirs: [config.EXPORT_DIR],
    target: `${connection.host}:${connection.port}/${connection.database}`,
  };
}
