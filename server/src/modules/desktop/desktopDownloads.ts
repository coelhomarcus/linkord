import { fetchConnectionJson, list, record, textValue, type RequestJson } from '../../integrations/connectionHttp.js';

// Where the web app's "the desktop app is here" announcement sends people: the Windows installer of
// the latest published release of DESKTOP_RELEASES_REPO (Windows is the only system the app ships for), the same releases the installed apps update
// from (docs/DEPLOY.md, "Desktop app"). Read from GitHub's public API, without a token, and kept
// for a while so a server full of people asks GitHub a handful of times an hour.

const CACHE_MS = 15 * 60 * 1000;
// An unavailable installer may appear when a release is published.
const FAILURE_CACHE_MS = 60 * 1000;

export interface DesktopDownloads {
  version: string;
  /** the release's page */
  page: string;
  files: { windows?: string };
}

// The installer's name (desktop/electron-builder.config.cjs artifactName)
const WINDOWS_INSTALLER = /^Overcord-[\w.-]+-win-x64\.exe$/;

/** GitHub's "latest release" answer, keeping only links into that repository's releases. */
export function parseLatestRelease(body: unknown, repo: string): DesktopDownloads | null {
  const release = record(body);
  const tag = textValue(release.tag_name);
  const page = textValue(release.html_url);
  const prefix = `https://github.com/${repo}/releases/`;
  if (!tag || !page?.startsWith(prefix) || release.draft === true || release.prerelease === true) return null;
  for (const asset of list(release.assets)) {
    const { name, browser_download_url: url } = record(asset);
    const fileName = textValue(name);
    const link = textValue(url);
    if (fileName && WINDOWS_INSTALLER.test(fileName) && link?.startsWith(`${prefix}download/`)) {
      return { version: tag.replace(/^v/, ''), page, files: { windows: link } };
    }
  }
  return null;
}

export function createDesktopDownloads(options: { repo: string; request?: RequestJson; now?: () => number }) {
  const { repo, request = (url, init) => fetchConnectionJson(url, init), now = Date.now } = options;
  let cached: { value: DesktopDownloads | null; until: number } | null = null;
  let pending: Promise<DesktopDownloads | null> | null = null;

  async function load(): Promise<DesktopDownloads | null> {
    try {
      const body = await request(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'overcord-server' },
      });
      const value = parseLatestRelease(body, repo);
      cached = { value, until: now() + (value ? CACHE_MS : FAILURE_CACHE_MS) };
      return value;
    } catch {
      cached = { value: cached?.value ?? null, until: now() + FAILURE_CACHE_MS };
      return cached.value;
    }
  }

  /** The latest installer, or null when there is no repository, no release with one, or GitHub cannot be reached. */
  return async function latest(): Promise<DesktopDownloads | null> {
    if (!repo) return null;
    if (cached && cached.until > now()) return cached.value;
    pending ??= load().finally(() => { pending = null; });
    return pending;
  };
}
