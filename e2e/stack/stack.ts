import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const E2E_DIR = path.resolve(import.meta.dirname, '..');
export const REPO_DIR = path.resolve(E2E_DIR, '..');
export const SPLIT = process.env.E2E_SPLIT === '1';
export const BASE_URL = SPLIT ? 'http://localhost:18080' : 'http://localhost:8080';
export const ADMIN_URL = 'http://127.0.0.1:18080';
export const SPLIT_LIVEKIT_URL = 'ws://lk.localhost:17880';
const COMPOSE_FILE = path.join(E2E_DIR, 'docker', 'compose.yml');
const SPLIT_FILE = path.join(E2E_DIR, 'docker', 'split.yml');
const ENV_FILE = path.join(E2E_DIR, '.e2e.env');
const STATE_FILE = path.join(E2E_DIR, SPLIT ? '.e2e-split-state.json' : '.e2e-state.json');
export const WEB_IMAGE = 'overcord-e2e:split-frontend';
export const ADMIN_IMAGE = 'overcord-e2e:split-admin';
export const NEXT_WEB_IMAGE = 'overcord-e2e:split-frontend-next';

interface StackState { image: string }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function compose(args: string[], image?: string, webImage = WEB_IMAGE): string {
  const env = { ...process.env, APP_IMAGE: image ?? currentImage(), WEB_IMAGE: webImage, ADMIN_IMAGE, ADMIN_URL };
  const files = SPLIT ? ['-p', 'overcord-e2e-split', '-f', COMPOSE_FILE, '-f', SPLIT_FILE] : ['-f', COMPOSE_FILE];
  return execFileSync('docker', ['compose', ...files, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

async function waitHealthy(route = '/healthz', timeoutMs = 60_000, origin = BASE_URL): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}${route}`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`the stack did not answer ${route} within ${timeoutMs} ms\n${logs(80)}`);
}

export async function up(image: string): Promise<void> {
  registrationCode();
  writeFileSync(STATE_FILE, JSON.stringify({ image } satisfies StackState));
  compose(['up', '-d', '--wait', 'postgres', 'mailsink'], image);
  compose(['up', '-d', 'livekit', 'proxy', 'app'], image);
  await waitHealthy();
  if (SPLIT) {
    compose(['up', '-d', '--no-deps', 'frontend', 'admin'], image);
    await waitHealthy('/index.html');
    await waitHealthy('/index.html', 60_000, ADMIN_URL);
  }
}

export async function replaceFrontend(): Promise<void> {
  compose(['up', '-d', '--force-recreate', '--no-deps', 'frontend'], undefined, NEXT_WEB_IMAGE);
  await waitHealthy('/index.html');
}

export function backendTask(): string {
  const id = compose(['ps', '-q', 'app']).trim();
  return execFileSync('docker', ['inspect', '--format', '{{.Id}} {{.State.StartedAt}}', id], { encoding: 'utf8' }).trim();
}

/** What a Dokploy compose redeploy does: the running container gets SIGTERM
 * and a new one starts from `image`. Same image = a plain redeploy. */
export async function deploy(image: string = currentImage()): Promise<void> {
  writeFileSync(STATE_FILE, JSON.stringify({ image } satisfies StackState));
  // Uploads from old root-owned images need the UID/GID used by both the Node and Bun images.
  compose(['run', '--rm', '--no-deps', '--user', 'root', '--entrypoint', 'chown', 'app', '-R', '1000:1000', '/app/uploads'], image);
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

const MAILSINK_URL = SPLIT ? 'http://localhost:18025' : 'http://localhost:8025';

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
  return compose(['exec', '-T', 'postgres', 'psql', '-U', 'overcord', '-d', 'overcord', '-tAc', query]).trim();
}

/** The one write with no HTTP path: the first administrator. */
export function grantAdmin(username: string): void {
  compose(['exec', '-T', 'postgres', 'psql', '-U', 'overcord', '-d', 'overcord', '-c', `UPDATE users SET role = 'admin' WHERE username = '${username.replace(/'/g, "''")}'`]);
}
