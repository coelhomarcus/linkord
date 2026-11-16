// Updates come from the GitHub releases of the repository the installer was
// built for (LINKORD_UPDATE_REPO, baked into app-config.json). Windows is the
// only system the app ships for: the NSIS build downloads an update in the
// background and installs it on the next restart.

export type UpdateMode = 'install' | 'off';

export interface UpdateRepo {
  owner: string;
  repo: string;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'downloaded'; version: string };

/** What a check found: an update (downloading), none, or an error. */
export type UpdateCheckOutcome =
  | { kind: 'up-to-date' }
  | { kind: 'update'; version: string }
  | { kind: 'failed' }
  | { kind: 'off' };

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
