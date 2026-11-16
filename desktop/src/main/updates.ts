// Updates come from the GitHub releases of the repository the installer was
// built for (LINKORD_UPDATE_REPO, baked into app-config.json). Windows is the
// only system the app ships for: the NSIS build checks at every start, with
// its own small window (updaterWindow.ts), and installs what it finds before
// opening; later checks download in the background and wait for a restart.

export type UpdateMode = 'install' | 'off';

export interface UpdateRepo {
  owner: string;
  repo: string;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string };

/** What a check found: an update (downloading), none, or an error. */
export type UpdateCheckOutcome =
  | { kind: 'up-to-date' }
  | { kind: 'update'; version: string }
  | { kind: 'failed' }
  | { kind: 'off' };

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** How long a start waits to hear whether there is an update before opening the app anyway. */
export const STARTUP_CHECK_TIMEOUT_MS = 8_000;
/** How long the updater window stays up to say a check from the tray found nothing. */
export const RESULT_LINGER_MS = 2_500;
/** Long enough to read "Installing…" before the window closes and the installer runs. */
export const INSTALL_DELAY_MS = 700;

/** A download's progress as a whole percentage. */
export function progressPercent(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.floor(value))) : 0;
}

/** A start with the system that stays in the tray checks in the background instead, with no window. */
export function checksAtStart(input: { mode: UpdateMode; startHidden: boolean }): boolean {
  return input.mode === 'install' && !input.startHidden;
}

const REPO_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/** "owner/repo", or null when it is not one. */
export function parseUpdateRepo(value: unknown): UpdateRepo | null {
  if (typeof value !== 'string') return null;
  const match = REPO_PATTERN.exec(value.trim());
  return match ? { owner: match[1], repo: match[2] } : null;
}

export function updateMode(input: { platform: NodeJS.Platform; isPackaged: boolean; repo: UpdateRepo | null }): UpdateMode {
  return input.isPackaged && input.repo && input.platform === 'win32' ? 'install' : 'off';
}
