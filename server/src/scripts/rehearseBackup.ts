import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { attachments, conversationMembers, conversations, messages, serverSounds, servers, stagedAttachments, users } from '../db/schema.js';
import { hashPassword } from '../modules/auth/password.js';
import { BackupError, DUMP_FILE, listBackups, UPLOADS_FILE } from './backup/backupLayout.js';
import { createBackup } from './backup/createBackup.js';
import { runTool } from './backup/postgresTools.js';
import { ConfirmationRequired, readBackup, restoreBackup } from './backup/restoreBackup.js';
import { listArchive } from './backup/uploadsArchive.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './rehearsal/isolatedDb.js';
import { makeMigrationsFolder } from './rehearsal/migrationFolders.js';
import { migrateOn } from './rehearsal/migrateOn.js';

// `npm run backup:rehearse [-- --keep]`
//
// Backup -> restore -> boot, end to end, on throwaway local databases:
//   1. a migrated database with a conversation, messages, attachments (with a
//      thumbnail), an avatar, a server sound and a staged file, plus the files
//      on disk and a half-finished chunked upload;
//   2. `createBackup` of it, with rotation;
//   3. `restoreBackup` into a second, empty database and uploads folder;
//   4. the app itself started on the restored data: a login and the downloads of
//      an attachment and the avatar, byte for byte.
// Needs pg_dump and pg_restore (PG_DUMP_BIN / PG_RESTORE_BIN); never touches the
// configured database, it only uses its server to create `linkord_rehearsal_*` ones.

const keep = process.argv.includes('--keep');
interface Step { name: string; ok: boolean; detail?: string }
const steps: Step[] = [];
const check = (name: string, ok: boolean, detail = ''): boolean => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
  return ok;
};
const note = (text: string) => console.log(`\n> ${text}`);

const PASSWORD = `rehearsal-${crypto.randomBytes(6).toString('hex')}`;
const id = (): string => crypto.randomUUID().replaceAll('-', '');
const count = async (pool: Pool, sql: string): Promise<number> => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const randomFile = async (dir: string, name: string, bytes: number): Promise<string> => {
  await fsp.writeFile(path.join(dir, name), crypto.randomBytes(bytes));
  return sha256(path.join(dir, name));
};

interface SeedManifest {
  users: { alice: string; bob: string };
  attachmentId: string;
  avatarId: string;
  /** file name -> sha256 of every stored file */
  hashes: Record<string, string>;
}

async function seed(pool: Pool, uploadDir: string): Promise<SeedManifest> {
  const orm = drizzle(pool);
  await fsp.mkdir(path.join(uploadDir, 'tmp', id()), { recursive: true });
  const hashes: Record<string, string> = {};
  const store = async (name: string, bytes: number): Promise<string> => { hashes[name] = await randomFile(uploadDir, name, bytes); return name; };

  const passwordHash = await hashPassword(PASSWORD);
  const alice = crypto.randomUUID();
  const bob = crypto.randomUUID();
  const avatarId = await store(id(), 4_096);
  await orm.insert(users).values([
    { id: alice, username: 'alice', passwordHash, avatar: `/uploads/${avatarId}` },
    { id: bob, username: 'bob', passwordHash },
  ]);
  const dm = crypto.randomUUID();
  await orm.insert(conversations).values({ id: dm, type: 'direct', dmKey: [alice, bob].sort().join(':'), createdBy: alice });
  await orm.insert(conversationMembers).values([{ conversationId: dm, userId: alice }, { conversationId: dm, userId: bob }]);
  const sent = await orm.insert(messages).values([
    { conversationId: dm, authorId: alice, text: 'first' },
    { conversationId: dm, authorId: bob, text: 'second' },
    { conversationId: dm, authorId: alice, text: 'with a file' },
  ]).returning({ id: messages.id });
  const messageId = sent[2]!.id;

  const attachmentId = await store(id(), 600_000);
  const thumbId = await store(id(), 8_000);
  await orm.insert(attachments).values([
    { id: attachmentId, messageId, uploaderId: alice, fileName: 'photo.png', mimeType: 'application/octet-stream', size: 600_000, thumbId },
    { id: thumbId, messageId, uploaderId: alice, fileName: 'photo.png', mimeType: 'application/octet-stream', size: 8_000, isThumbnail: true },
    { id: avatarId, messageId: null, uploaderId: alice, fileName: 'avatar.png', mimeType: 'application/octet-stream', size: 4_096 },
  ]);

  const server = crypto.randomUUID();
  await orm.insert(servers).values({ id: server, name: 'Rehearsal', ownerId: alice });
  const soundId = await store(id(), 20_000);
  await orm.insert(serverSounds).values({ id: soundId, serverId: server, uploaderId: alice, name: 'ding', size: 20_000, durationMs: 800 });

  const stagedId = await store(id(), 10_000);
  await orm.insert(stagedAttachments).values({
    id: stagedId, ownerId: bob, conversationId: dm, fileName: 'later.bin', mimeType: 'application/octet-stream', size: 10_000, expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { users: { alice, bob }, attachmentId, avatarId, hashes };
}

/** SHA-256 of every regular file directly in `dir`, `tmp/` left out. */
function hashFolder(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isFile()) out[entry.name] = sha256(path.join(dir, entry.name));
  return out;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address() as net.AddressInfo; server.close(() => resolve(port)); });
  });
}

async function waitFor<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

/** The real server on the restored database and folder, as a deploy would start it. */
async function bootApp(databaseUrl: string, uploadDir: string): Promise<{ origin: string; output: () => string; stop(): Promise<void> }> {
  const port = await freePort();
  const entry = path.join(import.meta.dirname, '..', 'index.ts');
  const env: NodeJS.ProcessEnv = {
    ...process.env, DATABASE_URL: databaseUrl, UPLOAD_DIR: uploadDir, PORT: String(port), HOST_BIND: '127.0.0.1',
    MIGRATE_ON_BOOT: '1', COOKIE_SECURE: '0', NODE_ENV: 'development', DATABASE_SSL: '0',
  };
  delete env.TRUST_PROXY;
  const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', (chunk: Buffer) => { log = (log + chunk.toString('utf8')).slice(-20_000); });
  const origin = `http://127.0.0.1:${port}`;
  await waitFor('the app to answer /healthz', async () => {
    if (child.exitCode !== null) throw new Error(`the app exited with ${child.exitCode}:\n${log}`);
    const res = await fetch(`${origin}/healthz`);
    return res.ok ? true : null;
  });
  return {
    origin, output: () => log,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => { child.once('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); }, 10_000).unref(); });
    },
  };
}

async function main(): Promise<number> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) { console.error('DATABASE_URL is not set'); return 2; }
  try {
    await runTool({ bin: process.env.PG_DUMP_BIN ?? 'pg_dump', args: ['--version'], what: 'pg_dump' });
    await runTool({ bin: process.env.PG_RESTORE_BIN ?? 'pg_restore', args: ['--version'], what: 'pg_restore' });
  } catch (err) {
    console.error(err instanceof BackupError ? err.message : err);
    return 2;
  }

  const dbs: IsolatedDatabase[] = [];
  const dirs: string[] = [];
  const tmp = async (label: string): Promise<string> => { const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `linkord-${label}-`)); dirs.push(dir); return dir; };
  let app: Awaited<ReturnType<typeof bootApp>> | null = null;
  try {
    note('A database with chat data and files');
    const source = await createIsolatedDatabase(baseUrl, 'rehearsal', `bk_src_${Date.now().toString(36)}`);
    dbs.push(source);
    const migrations = makeMigrationsFolder();
    try { await migrateOn(source.pool, migrations.folder); } finally { migrations.cleanup(); }
    const sourceUploads = await tmp('uploads-src');
    const seeded = await seed(source.pool, sourceUploads);
    check('source seeded', (await count(source.pool, 'select count(*) as n from messages')) === 3 && Object.keys(seeded.hashes).length === 5);

    note('Backup, with rotation');
    const backupDir = await tmp('backups');
    const bystander = path.join(backupDir, 'notes.txt');
    await fsp.writeFile(bystander, 'not a backup');
    const lookalike = path.join(backupDir, 'linkord-backup-keep-me');
    await fsp.mkdir(lookalike);
    const base = Date.now();
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await createBackup({
        databaseUrl: source.url, uploadDir: sourceUploads, backupDir, keep: 2, now: () => new Date(base + i * 60_000),
      }));
    }
    const remaining = await listBackups(backupDir);
    check('rotation keeps the newest 2 backups and removes the older ones', remaining.length === 2 && remaining[0] === path.basename(results[3]!.dir) && remaining[1] === path.basename(results[2]!.dir)
      && results[3]!.removed.length === 1, remaining.join(', '));
    check('rotation leaves files it did not create alone', fs.existsSync(bystander) && fs.existsSync(lookalike));
    check('no unfinished folder is left behind', fs.readdirSync(backupDir).every((name) => !name.endsWith('.partial')));
    const latest = results[3]!;
    check('manifest counts match the database (tables, migrations, files)',
      latest.manifest.tables.messages === 3 && latest.manifest.tables.attachments === 3 && latest.manifest.tables.users === 2 && latest.manifest.migrations > 0
      && latest.manifest.uploads.files === 5 && latest.manifest.uploads.missingFromArchive === 0, JSON.stringify(latest.manifest.uploads));
    const archived = await listArchive(path.join(latest.dir, UPLOADS_FILE));
    check('chunks of unfinished uploads (tmp/) are not archived', archived.every((entry) => !entry.startsWith('tmp')) && archived.length === 5);

    note('Restore into an empty database and folder');
    const target = await createIsolatedDatabase(baseUrl, 'rehearsal', `bk_dst_${Date.now().toString(36)}`);
    dbs.push(target);
    const targetUploads = await tmp('uploads-dst');
    const restoreOptions = { backupPath: latest.dir, databaseUrl: target.url, uploadDir: targetUploads, confirm: target.name };

    let unconfirmed: unknown = null;
    try { await restoreBackup({ ...restoreOptions, confirm: undefined }); } catch (err) { unconfirmed = err; }
    check('without --confirm nothing is restored', unconfirmed instanceof ConfirmationRequired && (await count(target.pool, "select count(*) as n from information_schema.tables where table_schema = 'public'")) === 0 && fs.readdirSync(targetUploads).length === 0);
    let wrongName: unknown = null;
    try { await restoreBackup({ ...restoreOptions, confirm: 'linkord' }); } catch (err) { wrongName = err; }
    check('confirming a different database name is refused', wrongName instanceof ConfirmationRequired);

    const damaged = await tmp('damaged');
    await fsp.cp(latest.dir, damaged, { recursive: true });
    const dumpPath = path.join(damaged, DUMP_FILE);
    const bytes = fs.readFileSync(dumpPath);
    bytes[Math.floor(bytes.length / 2)]! ^= 0xff;
    fs.writeFileSync(dumpPath, bytes);
    let damagedError: unknown = null;
    try { await readBackup(damaged); } catch (err) { damagedError = err; }
    check('a backup whose checksum does not match is refused before anything is touched', damagedError instanceof BackupError && /checksum/.test(String((damagedError as Error).message)));

    const restored = await restoreBackup(restoreOptions);
    check('restore reports no mismatch and no warning', restored.integrity.errors.length === 0 && restored.integrity.warnings.length === 0, JSON.stringify(restored.integrity));
    check('every table has the same rows as the source', (await Promise.all(Object.entries(latest.manifest.tables).map(
      async ([table, n]) => (await count(target.pool, `select count(*) as n from public."${table}"`)) === n))).every(Boolean));
    check('every file is back, byte for byte', JSON.stringify(hashFolder(targetUploads)) === JSON.stringify(hashFolder(sourceUploads)) && !fs.existsSync(path.join(targetUploads, 'tmp')));
    check('attachments match files on disk (attachment, thumbnail, avatar, sound and staged file all have theirs)', restored.integrity.tracked === 5 && restored.integrity.missingFiles === 0 && restored.integrity.orphanFiles === 0);

    let notEmpty: unknown = null;
    try { await restoreBackup(restoreOptions); } catch (err) { notEmpty = err; }
    check('a second restore into the same database is refused', notEmpty instanceof BackupError && !(notEmpty instanceof ConfirmationRequired));
    const emptyDb = await createIsolatedDatabase(baseUrl, 'rehearsal', `bk_dst2_${Date.now().toString(36)}`);
    dbs.push(emptyDb);
    let notEmptyDir: unknown = null;
    try { await restoreBackup({ ...restoreOptions, databaseUrl: emptyDb.url, confirm: emptyDb.name }); } catch (err) { notEmptyDir = err; }
    check('a restore never goes into a folder that already has files (and leaves the database empty)', notEmptyDir instanceof BackupError
      && (await count(emptyDb.pool, "select count(*) as n from information_schema.tables where table_schema = 'public'")) === 0);

    note('The app on the restored data');
    app = await bootApp(target.url, targetUploads);
    check('the app boots and applies no migration (the restored database already has them all)',
      (await count(target.pool, 'select count(*) as n from drizzle.__drizzle_migrations')) === latest.manifest.migrations && /migrations up to date/.test(app.output()));
    const login = await fetch(`${app.origin}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: PASSWORD }),
    });
    const cookie = (login.headers.getSetCookie()[0] ?? '').split(';')[0]!;
    check('an account from the backup can sign in', login.status === 200 && cookie.includes('='));
    const download = async (fileId: string): Promise<string | null> => {
      const res = await fetch(`${app!.origin}/uploads/${fileId}`, { headers: { cookie } });
      return res.status === 200 ? crypto.createHash('sha256').update(Buffer.from(await res.arrayBuffer())).digest('hex') : null;
    };
    check('the chat attachment downloads with its original bytes', (await download(seeded.attachmentId)) === seeded.hashes[seeded.attachmentId]);
    check('the avatar downloads with its original bytes', (await download(seeded.avatarId)) === seeded.hashes[seeded.avatarId]);
    await app.stop();
    app = null;

    note('A file deleted between the snapshot and the archive');
    await source.pool.query(
      "insert into attachments (id, message_id, uploader_id, file_name, mime_type, size) select $1, id, $2, 'gone.bin', 'application/octet-stream', 1 from messages limit 1",
      [id(), seeded.users.alice],
    );
    const withGap = await createBackup({ databaseUrl: source.url, uploadDir: sourceUploads, backupDir, keep: 2, now: () => new Date(base + 10 * 60_000) });
    check('the backup counts the file that was not there', withGap.manifest.uploads.missingFromArchive === 1);
    const gapDb = await createIsolatedDatabase(baseUrl, 'rehearsal', `bk_gap_${Date.now().toString(36)}`);
    dbs.push(gapDb);
    const gapUploads = await tmp('uploads-gap');
    const gap = await restoreBackup({ backupPath: withGap.dir, databaseUrl: gapDb.url, uploadDir: gapUploads, confirm: gapDb.name });
    check('restore warns about it, and does not call it a mismatch', gap.integrity.errors.length === 0 && gap.integrity.missingFiles === 1 && gap.integrity.warnings.length === 1, gap.integrity.warnings.join(' '));
  } catch (err) {
    check('the rehearsal finished without an unexpected exception', false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    await app?.stop().catch(() => {});
    if (!keep) {
      for (const db of dbs) await db.drop().catch((err) => console.error(`could not drop ${db.name}:`, err));
      for (const dir of dirs) await fsp.rm(dir, { recursive: true, force: true });
    } else {
      console.log(`\n--keep: databases ${dbs.map((d) => d.name).join(', ')} and folders ${dirs.join(', ')} left in place`);
      for (const db of dbs) await db.pool.end().catch(() => {});
    }
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(failed.length === 0 ? `\nREHEARSAL OK - ${steps.length} checks` : `\n${failed.length} CHECK(S) FAILED`);
  return failed.length === 0 ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; });
