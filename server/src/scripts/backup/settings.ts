import path from 'node:path';
import { config } from '../../config/env.js';
import { BackupError, parseKeep } from './backupLayout.js';
import { pgConnection, type DatabaseSsl } from './postgresTools.js';

// `backup` and `restore` only ever act on the database and uploads folder the
// app itself is configured with (DATABASE_URL, UPLOAD_DIR). There is no flag to
// aim them elsewhere on purpose: a script that dumps or fills a database should
// not have a way to pick the wrong one from a typo.

export interface BackupSettings {
  databaseUrl: string;
  ssl: DatabaseSsl;
  uploadDir: string;
  backupDir: string;
  keep: number;
  /** "host:port/database", with no credentials, for messages */
  target: string;
}

// server/src/scripts/backup -> repo root; compiled, server/dist/scripts/backup -> /app in the image
const DEFAULT_BACKUP_DIR = path.join(import.meta.dirname, '..', '..', '..', '..', 'backups');

export function backupSettings(env: NodeJS.ProcessEnv = process.env): BackupSettings {
  if (!config.DATABASE_URL) throw new BackupError('DATABASE_URL is not set (see .env.example).');
  const connection = pgConnection(config.DATABASE_URL);
  return {
    databaseUrl: config.DATABASE_URL,
    ssl: { enabled: config.DATABASE_SSL, ca: config.DATABASE_SSL_CA || undefined },
    uploadDir: config.UPLOAD_DIR,
    backupDir: path.resolve(env.BACKUP_DIR || DEFAULT_BACKUP_DIR),
    keep: parseKeep(env.BACKUP_KEEP),
    target: `${connection.host}:${connection.port}/${connection.database}`,
  };
}
