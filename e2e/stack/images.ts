import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ADMIN_IMAGE, ADMIN_URL, BASE_URL, NEXT_WEB_IMAGE, REPO_DIR, SPLIT, SPLIT_LIVEKIT_URL, WEB_IMAGE } from './stack';

/** E2E_HEAD_IMAGE runs the suite against an image built elsewhere (to check
 * that a spec catches a regression, build the broken tree and point here). */
export const HEAD_IMAGE = process.env.E2E_HEAD_IMAGE || 'linkord-e2e:head';

function run(cmd: string, args: string[], cwd = REPO_DIR, input?: string): string {
  return execFileSync(cmd, args, { cwd, input, encoding: 'utf8', stdio: [input ? 'pipe' : 'ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
}

function imageExists(tag: string): boolean {
  try { run('docker', ['image', 'inspect', tag]); return true; } catch { return false; }
}

/** The working tree as it is now, uncommitted changes included. Rebuilt every
 * run; Docker's layer cache keeps an unchanged tree fast. */
export function buildHeadImage(): string {
  if (SPLIT) {
    const backend = process.env.E2E_HEAD_IMAGE || 'linkord-e2e:split-backend';
    if (!process.env.E2E_HEAD_IMAGE) run('docker', ['build', '-q', '--target', 'backend', '-t', backend, '.']);
    run('docker', ['build', '-q', '--target', 'frontend', '--build-arg', `APP_URL=${BASE_URL}`,
      '--build-arg', `LIVEKIT_URL=${SPLIT_LIVEKIT_URL}`, '-t', WEB_IMAGE, '.']);
    run('docker', ['build', '-q', '--target', 'admin', '--build-arg', `APP_URL=${ADMIN_URL}`, '-t', ADMIN_IMAGE, '.']);
    // A visible build change without altering any inline code covered by CSP.
    run('docker', ['build', '-q', '-t', NEXT_WEB_IMAGE, '-'], REPO_DIR, [
      `FROM ${WEB_IMAGE}`,
      'USER root',
      'RUN echo "<!-- split frontend replacement -->" >> /usr/share/nginx/linkord/index.html',
      'USER 101',
    ].join('\n'));
    return backend;
  }
  if (process.env.E2E_HEAD_IMAGE) return HEAD_IMAGE;
  run('docker', ['build', '-q', '-t', HEAD_IMAGE, '.']);
  return HEAD_IMAGE;
}

export interface BaseVersion {
  ref: string;
  sha: string;
  image: string;
  protocolVersion: number;
  minProtocolVersion: number;
  /** whether that version already persists call membership (see AGENTS.md) */
  restoresCalls: boolean;
  /** Whether that version's shutdown leaves tabs able to reconnect on their own.
   * An older one sent each socket a disconnect, after which Socket.IO only
   * reconnects when the tab is focused again. */
  shutdownLetsTabsReconnect: boolean;
}

function showFile(sha: string, file: string): string {
  try { return run('git', ['show', `${sha}:${file}`]); } catch { return ''; }
}

function readConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
  if (!match) throw new Error(`${name} not found in protocolVersion.ts`);
  return Number(match[1]);
}

/** The version in production (`origin/main` unless E2E_BASE_REF says otherwise),
 * built once per commit from a clean checkout of that commit. */
export function baseVersion(): BaseVersion {
  const ref = process.env.E2E_BASE_REF || 'origin/main';
  const sha = run('git', ['rev-parse', ref]).trim();
  const image = `linkord-e2e:base-${sha.slice(0, 12)}`;
  const protocol = showFile(sha, 'server/src/realtime/protocolVersion.ts');
  const version: BaseVersion = {
    ref,
    sha,
    image,
    protocolVersion: readConstant(protocol, 'PROTOCOL_VERSION'),
    minProtocolVersion: readConstant(protocol, 'MIN_PROTOCOL_VERSION'),
    restoresCalls: showFile(sha, 'server/src/db/schema.ts').includes("pgTable('call_presence'"),
    shutdownLetsTabsReconnect: !showFile(sha, 'server/src/app/bootstrap.ts').includes('.disconnect(true)'),
  };
  if (!imageExists(image)) {
    const checkout = mkdtempSync(path.join(tmpdir(), 'linkord-e2e-base-'));
    try {
      run('git', ['worktree', 'add', '--detach', checkout, sha]);
      run('docker', ['build', '-q', '-t', image, '.'], checkout);
    } finally {
      try { run('git', ['worktree', 'remove', '--force', checkout]); } catch { rmSync(checkout, { recursive: true, force: true }); }
    }
  }
  return version;
}

export function headProtocol(): { protocolVersion: number; minProtocolVersion: number } {
  const source = readFileSync(path.join(REPO_DIR, 'server/src/realtime/protocolVersion.ts'), 'utf8');
  return { protocolVersion: readConstant(source, 'PROTOCOL_VERSION'), minProtocolVersion: readConstant(source, 'MIN_PROTOCOL_VERSION') };
}
