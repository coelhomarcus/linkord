import { parseUpdateRepo, type UpdateRepo } from './updates.js';

// What the window loads: the Linkord server itself, not a bundled copy of the
// web app. The page then talks to /api and /ws on its own origin, so the
// server's cookies, origin guard and CSP apply unchanged, and a deploy updates
// the interface without a new desktop build.

export const DEV_APP_URL = 'http://localhost:5173';

const URL_FLAG = '--url=';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type AppUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: 'missing' | 'invalid' | 'insecure'; value?: string };

export function resolveAppUrl(input: {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  isPackaged: boolean;
  /** the address `npm run package` baked into an installer */
  bundledUrl?: string;
}): AppUrlResult {
  const fromArgv = input.argv.find((arg) => arg.startsWith(URL_FLAG))?.slice(URL_FLAG.length);
  const value = fromArgv || input.env.LINKORD_URL?.trim() || input.bundledUrl || (input.isPackaged ? undefined : DEV_APP_URL);
  if (!value) return { ok: false, reason: 'missing' };

  let url: URL;
  try { url = new URL(value); } catch { return { ok: false, reason: 'invalid', value }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'invalid', value };
  // The session cookie must not travel in the clear to anything but this machine
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return { ok: false, reason: 'insecure', value };
  return { ok: true, url };
}

/** app-config.json, written next to the compiled code when an installer is built. */
export function parseAppConfig(raw: unknown): { url?: string; updateRepo?: UpdateRepo } {
  if (!raw || typeof raw !== 'object') return {};
  const { url, updateRepo } = raw as { url?: unknown; updateRepo?: unknown };
  const repo = parseUpdateRepo(updateRepo);
  return {
    ...(typeof url === 'string' && url ? { url } : {}),
    ...(repo ? { updateRepo: repo } : {}),
  };
}
