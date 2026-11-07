import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const E2E_DIR = path.resolve(import.meta.dirname, '..');
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
export function currentImage(): string {
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

export async function waitHealthy(timeoutMs = 60_000): Promise<void> {
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
  compose(['up', '-d', '--wait', 'postgres'], image);
  compose(['up', '-d', 'livekit', 'proxy', 'app'], image);
  await waitHealthy();
}

/** What a Dokploy compose redeploy does: the running container gets SIGTERM
 * and a new one starts from `image`. Same image = a plain redeploy. */
export async function deploy(image: string = currentImage()): Promise<void> {
  writeFileSync(STATE_FILE, JSON.stringify({ image } satisfies StackState));
  compose(['up', '-d', '--force-recreate', '--no-deps', 'app'], image);
  await waitHealthy();
}

/** Takes the app away for `seconds` (SIGTERM, then nothing listening), as a
 * slow deploy would, and brings the same image back. */
export async function outage(seconds: number): Promise<void> {
  compose(['stop', '-t', '10', 'app']);
  await sleep(seconds * 1000);
  compose(['start', 'app']);
  await waitHealthy();
}

export function down(): void {
  if (!readState()) return;
  compose(['down', '-v', '--remove-orphans']);
  rmSync(STATE_FILE, { force: true });
}

export function logs(lines = 200): string {
  try { return compose(['logs', '--no-color', '--tail', String(lines), 'app']); } catch { return '(no logs)'; }
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
