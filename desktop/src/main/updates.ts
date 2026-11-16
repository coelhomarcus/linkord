// Updates come from the GitHub releases of the repository the installer was
// built for (LINKORD_UPDATE_REPO, baked into app-config.json). Where the app
// can replace itself it does: Windows (NSIS) and the AppImage download in the
// background and install on the next restart. macOS cannot: Squirrel.Mac only
// accepts an update signed with the same Developer ID, and these builds have
// an ad-hoc signature, so a Mac (and a .deb, which needs a password to
// install) is told about the new version and sent to its release page.

export type UpdateMode = 'install' | 'notify' | 'off';

export interface UpdateRepo {
  owner: string;
  repo: string;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'available'; version: string; url: string }
  | { kind: 'downloaded'; version: string };

/** What a check found: an update (downloading, or to download from its page), none, or an error. */
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

export function updateMode(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  repo: UpdateRepo | null;
  /** set by the AppImage runtime; a .deb install has none */
  appImage: string | undefined;
}): UpdateMode {
  if (!input.isPackaged || !input.repo) return 'off';
  if (input.platform === 'win32') return 'install';
  if (input.platform === 'linux' && input.appImage) return 'install';
  return 'notify';
}

export function latestReleaseApiUrl(repo: UpdateRepo): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`;
}

function versionParts(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const now = versionParts(current);
  if (!next || !now) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== now[i]) return next[i] > now[i];
  }
  return false;
}

/**
 * The release GitHub's "latest release" endpoint returned, when it is newer
 * than this build. Its page is opened in the browser, so only a page of the
 * same repository's releases is accepted.
 */
export function newerRelease(body: unknown, current: string, repo: UpdateRepo): { version: string; url: string } | null {
  if (!body || typeof body !== 'object') return null;
  const { tag_name: tag, html_url: url, draft, prerelease } = body as Record<string, unknown>;
  if (typeof tag !== 'string' || typeof url !== 'string' || draft === true || prerelease === true) return null;
  if (!url.startsWith(`https://github.com/${repo.owner}/${repo.repo}/releases/`)) return null;
  if (!isNewerVersion(tag, current)) return null;
  return { version: tag.replace(/^v/, ''), url };
}
