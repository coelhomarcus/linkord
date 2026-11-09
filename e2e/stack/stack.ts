import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const E2E_DIR = path.resolve(import.meta.dirname, '..');
export const REPO_DIR = path.resolve(E2E_DIR, '..');
export const BASE_URL = 'http://localhost:8080';
const COMPOSE_FILE = path.join(E2E_DIR, 'docker', 'compose.yml');
const ENV_FILE = path.join(E2E_DIR, '.e2e.env');
const STATE_FILE = path.join(E2E_DIR, '.e2e-state.json');

interface StackState { image: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function compose(args: string[], image?: string): string {
  const env = { ...process.env, APP_IMAGE: image ?? currentImage() };
  return execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readState(): StackState | null {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StackState : null;
}

/** The image the app service runs right now. Kept in a file because Playwright
 * runs global setup, workers and teardown in different processes. */
function currentImage(): string {
  const state = readState();
  if (!state) throw new Error('the e2e stack is not up');
  return state.image;
}

/** The registration code is a throwaway secret per run, never a real one. */
export function registrationCode(): string {
  if (!existsSync(ENV_FILE)) writeFileSync(ENV_FILE, `REGISTRATION_CODE=e2e-${randomBytes(12).toString('hex')}\n`);
  const match = readFileSync(ENV_FILE, 'utf8').match(/^REGISTRATION_CODE=(.+)$/m);
  if (!match) throw new Error(`${ENV_FILE} has no REGISTRATION_CODE`);
  return match[1]!;
}

async function waitHealthy(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/healthz`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`the app did not answer /healthz within ${timeoutMs} ms\n${logs(80)}`);
}

export async function up(image: string): Promise<void> {
  registrationCode();
  writeFileSync(STATE_FILE, JSON.stringify({ image } satisfies StackState));
  compose(['up', '-d', '--wait', 'postgres', 'mailsink'], image);
  compose(['up', '-d', 'livekit', 'proxy', 'app'], image);
  await waitHealthy();
}

/** What a Dokploy compose redeploy does: the running container gets SIGTERM
 * and a new one starts from `image`. Same image = a plain redeploy. */
export async function deploy(image: string = currentImage()): Promise<void> {
  writeFileSync(STATE_FILE, JSON.stringify({ image } satisfies StackState));
  // The upgrade specs start from a version that ran as root, whose files the `node` user of this one cannot
  // write. This is the `chown` docs/DEPLOY.md asks for before an upgrade.
  compose(['run', '--rm', '--no-deps', '--user', 'root', '--entrypoint', 'chown', 'app', '-R', 'node:node', '/app/uploads'], image);
  compose(['up', '-d', '--force-recreate', '--no-deps', 'app'], image);
  await waitHealthy();
}

/** The app container is gone (after SIGTERM): the proxy has nothing behind it. */
export function stopApp(): void {
  compose(['stop', '-t', '10', 'app']);
}

export async function startApp(): Promise<void> {
  compose(['start', 'app']);
  await waitHealthy();
}

export function down(): void {
  if (!readState()) return;
  compose(['down', '-v', '--remove-orphans']);
  rmSync(STATE_FILE, { force: true });
}

function logs(lines = 200): string {
  try { return compose(['logs', '--no-color', '--tail', String(lines), 'app']); } catch { return '(no logs)'; }
}

const MAILSINK_URL = 'http://localhost:8025';

async function emailsTo(to: string): Promise<{ text: string }[]> {
  const res = await fetch(`${MAILSINK_URL}/emails?to=${encodeURIComponent(to)}`);
  return await res.json() as { text: string }[];
}

/** How many emails `to` has received so far: pass it to waitForEmailCode to wait for the next one.
 * (A count, not a time: the sink's clock is the container's, not this machine's.) */
export async function emailCount(to: string): Promise<number> {
  return (await emailsTo(to)).length;
}

/** The 6-digit code of the first email `to` receives after the first `seen` ones, waiting for it. Emails
 * without a code (the new sign-in alert) are skipped. */
export async function waitForEmailCode(to: string, seen: number, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = (await emailsTo(to)).slice(seen).map((mail) => mail.text.match(/\b(\d{6})\b/)?.[1]).find(Boolean);
    if (code) return code;
    await sleep(200);
  }
  throw new Error(`no code emailed to ${to} within ${timeoutMs} ms`);
}

/** Read-only checks against the app's database. Writes go through the app's
 * own HTTP flows: it caches memberships in memory, so a row written behind
 * its back is invisible until the next restart. */
export function sql(query: string): string {
  return compose(['exec', '-T', 'postgres', 'psql', '-U', 'linkord', '-d', 'linkord', '-tAc', query]).trim();
}

/** The one write with no HTTP path: the first administrator. */
export function grantAdmin(username: string): void {
  compose(['exec', '-T', 'postgres', 'psql', '-U', 'linkord', '-d', 'linkord', '-c', `UPDATE users SET role = 'admin' WHERE username = '${username.replace(/'/g, "''")}'`]);
}
